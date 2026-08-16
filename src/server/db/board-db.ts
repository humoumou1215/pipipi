import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BOARD_SCHEMA, DEFAULT_COLUMNS } from "./schema";

export interface ColumnRow {
	id: number;
	name: string;
	position: number;
	claimable: number;
	done: number;
	workflowRole: string | null;
}

export interface CardRow {
	id: number;
	title: string;
	description: string;
	type: string;
	priority: number;
	tags: string[];
	columnId: number;
	status: string;
	holderId: string | null;
	assigneeRole: string | null;
	stageIdx: number;
	dueAt: string | null;
	reviewApprover: number | null;
	version: number;
	createdBy: number | null;
	createdAt: string;
	updatedAt: string;
}

export interface StageRow {
	id: number;
	cardId: number;
	roleId: string;
	title: string;
	description: string;
	status: string;
	doneBy: string | null;
	position: number;
}

export interface ChecklistRow {
	id: number;
	cardId: number;
	text: string;
	done: number;
	position: number;
}

export interface ActivityRow {
	id: number;
	cardId: number;
	actorKind: string;
	actorId: string;
	type: string;
	payload: Record<string, unknown>;
	createdAt: string;
}

export interface WakeSignalRow {
	id: number;
	targetRoleId: string;
	targetInstanceId: string | null;
	cardId: number | null;
	source: string;
	priority: number;
	status: string;
	dedupeKey: string | null;
	createdAt: string;
	processedAt: string | null;
}

export interface RoleRow {
	id: string;
	name: string;
	kind: string;
	model: string | null;
	thinkingLevel: string;
	instanceCount: number;
	claimPolicy: Record<string, unknown>;
	mentionPolicy: Record<string, unknown>;
	roleDir: string;
	updatedAt: string;
}

export interface InstanceRow {
	id: string;
	roleId: string;
	idx: number;
	status: string;
	currentCardId: number | null;
	queueLen: number;
	heartbeatAt: string;
}

export interface UsageRow {
	id: number;
	roleId: string | null;
	instanceId: string | null;
	cardId: number | null;
	model: string | null;
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	createdAt: string;
}

export interface CardDetail extends CardRow {
	stages: StageRow[];
	checklist: ChecklistRow[];
}

export const CARD_STATUSES = ["ready", "claimed", "in_progress", "review", "blocked", "done", "archived"] as const;

/** 每目录看板数据库(所有写操作经事务) */
export class BoardDb {
	private db: DatabaseSync;

	private constructor(db: DatabaseSync) {
		this.db = db;
	}

	static open(dir: string): BoardDb {
		const kanbanDir = join(dir, ".kanban");
		mkdirSync(kanbanDir, { recursive: true });
		mkdirSync(join(kanbanDir, "sessions"), { recursive: true });
		mkdirSync(join(kanbanDir, "scratchpads"), { recursive: true });
		const db = new DatabaseSync(join(kanbanDir, "board.db"));
		db.exec("PRAGMA journal_mode=WAL");
		db.exec("PRAGMA foreign_keys=ON");
		db.exec(BOARD_SCHEMA);
		const board = new BoardDb(db);
		board.seedDefaultColumns();
		return board;
	}

	close(): void {
		this.db.close();
	}

	/** 事务执行器 */
	withTx<T>(fn: () => T): T {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const result = fn();
			this.db.exec("COMMIT");
			return result;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	private seedDefaultColumns(): void {
		const count = this.db.prepare("SELECT COUNT(*) AS n FROM columns").get() as { n: number };
		if (Number(count.n) > 0) return;
		const insert = this.db.prepare(
			"INSERT INTO columns (name, position, claimable, done) VALUES (?, ?, ?, ?)",
		);
		DEFAULT_COLUMNS.forEach((col, idx) => {
			insert.run(col.name, idx, col.claimable, col.done);
		});
	}

	// ---------- columns ----------

	listColumns(): ColumnRow[] {
		const rows = this.db.prepare("SELECT * FROM columns ORDER BY position").all() as Record<string, unknown>[];
		return rows.map(mapColumn);
	}

	getColumn(id: number): ColumnRow | undefined {
		const row = this.db.prepare("SELECT * FROM columns WHERE id = ?").get(id) as Record<string, unknown> | undefined;
		return row ? mapColumn(row) : undefined;
	}

	createColumn(input: { name: string; position: number; claimable: boolean; done: boolean; workflowRole?: string }): ColumnRow {
		this.db
			.prepare("INSERT INTO columns (name, position, claimable, done, workflow_role) VALUES (?, ?, ?, ?, ?)")
			.run(input.name, input.position, input.claimable ? 1 : 0, input.done ? 1 : 0, input.workflowRole ?? null);
		const row = this.db.prepare("SELECT * FROM columns WHERE id = last_insert_rowid()").get() as
			| Record<string, unknown>
			| undefined;
		if (!row) throw new Error("column create failed");
		return mapColumn(row);
	}

	updateColumn(id: number, fields: Partial<{ name: string; position: number; claimable: boolean; done: boolean; workflowRole: string | null }>): void {
		const sets: string[] = [];
		const params: (string | number | null)[] = [];
		if (fields.name !== undefined) {
			sets.push("name = ?");
			params.push(fields.name);
		}
		if (fields.position !== undefined) {
			sets.push("position = ?");
			params.push(fields.position);
		}
		if (fields.claimable !== undefined) {
			sets.push("claimable = ?");
			params.push(fields.claimable ? 1 : 0);
		}
		if (fields.done !== undefined) {
			sets.push("done = ?");
			params.push(fields.done ? 1 : 0);
		}
		if (fields.workflowRole !== undefined) {
			sets.push("workflow_role = ?");
			params.push(fields.workflowRole);
		}
		if (sets.length === 0) return;
		params.push(id);
		this.db.prepare(`UPDATE columns SET ${sets.join(", ")} WHERE id = ?`).run(...params);
	}

	// ---------- cards ----------

	createCard(input: {
		title: string;
		description?: string;
		type?: string;
		priority?: number;
		tags?: string[];
		columnId: number;
		assigneeRole?: string | null;
		reviewApprover?: number | null;
		stages?: Array<{ roleId: string; title?: string; description?: string }>;
		createdBy: number | null;
	}): CardRow {
		const now = new Date().toISOString();
		return this.withTx(() => {
			this.db
				.prepare(
					`INSERT INTO cards (title, description, type, priority, tags, column_id, status, assignee_role, review_approver, created_by, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?)`,
				)
				.run(
					input.title,
					input.description ?? "",
					input.type ?? "task",
					input.priority ?? 0,
					JSON.stringify(input.tags ?? []),
					input.columnId,
					input.assigneeRole ?? null,
					input.reviewApprover ?? null,
					input.createdBy,
					now,
					now,
				);
			const cardId = Number(this.db.prepare("SELECT last_insert_rowid() AS id").get()!.id);
			(input.stages ?? []).forEach((stage, idx) => {
				this.db
					.prepare(
						"INSERT INTO stages (card_id, role_id, title, description, status, position) VALUES (?, ?, ?, ?, 'pending', ?)",
					)
					.run(cardId, stage.roleId, stage.title ?? "", stage.description ?? "", idx);
			});
			const card = this.getCard(cardId);
			if (!card) throw new Error("card create failed");
			return card;
		});
	}

	getCard(id: number): CardDetail | undefined {
		const row = this.db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as Record<string, unknown> | undefined;
		if (!row) return undefined;
		const card = mapCard(row);
		const stages = (this.db.prepare("SELECT * FROM stages WHERE card_id = ? ORDER BY position").all(id) as Record<string, unknown>[]).map(mapStage);
		const checklist = (this.db.prepare("SELECT * FROM checklist_items WHERE card_id = ? ORDER BY position").all(id) as Record<string, unknown>[]).map(mapChecklist);
		return { ...card, stages, checklist };
	}

	listCards(input?: { columnId?: number; status?: string; assigneeRole?: string; holderId?: string }): CardRow[] {
		const clauses: string[] = [];
		const params: (string | number)[] = [];
		if (input?.columnId !== undefined) {
			clauses.push("column_id = ?");
			params.push(input.columnId);
		}
		if (input?.status !== undefined) {
			clauses.push("status = ?");
			params.push(input.status);
		}
		if (input?.assigneeRole !== undefined) {
			clauses.push("assignee_role = ?");
			params.push(input.assigneeRole);
		}
		if (input?.holderId !== undefined) {
			clauses.push("holder_id = ?");
			params.push(input.holderId);
		}
		const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.db.prepare(`SELECT * FROM cards ${where} ORDER BY priority DESC, updated_at DESC`).all(...params) as Record<string, unknown>[];
		return rows.map(mapCard);
	}

	updateCard(
		id: number,
		fields: Partial<{
			title: string;
			description: string;
			type: string;
			priority: number;
			tags: string[];
			dueAt: string | null;
			reviewApprover: number | null;
		}>,
		expectedVersion?: number,
	): CardRow {
		const now = new Date().toISOString();
		return this.withTx(() => {
			const current = this.db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as Record<string, unknown> | undefined;
			if (!current) throw new Error("card not found");
			if (expectedVersion !== undefined && Number(current.version) !== expectedVersion) {
				throw new CardVersionConflict(Number(current.version));
			}
			const sets: string[] = [];
			const params: (string | number | null)[] = [];
			if (fields.title !== undefined) {
				sets.push("title = ?");
				params.push(fields.title);
			}
			if (fields.description !== undefined) {
				sets.push("description = ?");
				params.push(fields.description);
			}
			if (fields.type !== undefined) {
				sets.push("type = ?");
				params.push(fields.type);
			}
			if (fields.priority !== undefined) {
				sets.push("priority = ?");
				params.push(fields.priority);
			}
			if (fields.tags !== undefined) {
				sets.push("tags = ?");
				params.push(JSON.stringify(fields.tags));
			}
			if (fields.dueAt !== undefined) {
				sets.push("due_at = ?");
				params.push(fields.dueAt);
			}
			if (fields.reviewApprover !== undefined) {
				sets.push("review_approver = ?");
				params.push(fields.reviewApprover);
			}
			sets.push("version = version + 1");
			sets.push("updated_at = ?");
			params.push(now, id);
			this.db.prepare(`UPDATE cards SET ${sets.join(", ")} WHERE id = ?`).run(...params);
			const card = this.getCard(id);
			if (!card) throw new Error("card not found after update");
			return card;
		});
	}

	/** 原子认领:仅可认领列 + 无 holder + ready */
	claimCard(cardId: number, instanceId: string): boolean {
		return this.withTx(() => {
			const now = new Date().toISOString();
			const result = this.db
				.prepare(
					`UPDATE cards SET holder_id = ?, status = 'claimed', version = version + 1, updated_at = ?
					 WHERE id = ? AND holder_id IS NULL AND status = 'ready'
					   AND column_id IN (SELECT id FROM columns WHERE claimable = 1)`,
				)
				.run(instanceId, now, cardId);
			return result.changes > 0;
		});
	}

	/** 指派/提及绑定:不竞争(仅当无 holder) */
	bindCard(cardId: number, instanceId: string): boolean {
		const now = new Date().toISOString();
		const result = this.db
			.prepare(
				"UPDATE cards SET holder_id = ?, status = 'claimed', version = version + 1, updated_at = ? WHERE id = ? AND holder_id IS NULL",
			)
			.run(instanceId, now, cardId);
		return result.changes > 0;
	}

	setCardInProgress(cardId: number): void {
		this.db
			.prepare("UPDATE cards SET status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'claimed'")
			.run(new Date().toISOString(), cardId);
	}

	/** 释放认领:仅 claimed/in_progress 回 ready,其余(done/blocked/review)不动 */
	releaseCard(cardId: number): void {
		const now = new Date().toISOString();
		this.db
			.prepare(
				"UPDATE cards SET holder_id = NULL, status = 'ready', version = version + 1, updated_at = ? WHERE id = ? AND status IN ('claimed', 'in_progress')",
			)
			.run(now, cardId);
	}

	/** 回收过期认领(心跳 TTL) */
	reapStaleClaims(ttlMs: number): number {
		const threshold = new Date(Date.now() - ttlMs).toISOString();
		const rows = this.db
			.prepare("SELECT id, holder_id FROM cards WHERE holder_id IS NOT NULL AND status IN ('claimed', 'in_progress')")
			.all() as Record<string, unknown>[];
		let reaped = 0;
		for (const row of rows) {
			const holderId = String(row.holder_id);
			const inst = this.db.prepare("SELECT heartbeat_at FROM instances WHERE id = ?").get(holderId) as
				| { heartbeat_at: string }
				| undefined;
			if (!inst || inst.heartbeat_at < threshold) {
				this.releaseCard(Number(row.id));
				this.addActivity(Number(row.id), "system", "system", "claim_reaped", { holderId });
				reaped++;
			}
		}
		return reaped;
	}

	moveCard(cardId: number, columnId: number): CardRow {
		const now = new Date().toISOString();
		this.db
			.prepare("UPDATE cards SET column_id = ?, version = version + 1, updated_at = ? WHERE id = ?")
			.run(columnId, now, cardId);
		const card = this.getCard(cardId);
		if (!card) throw new Error("card not found");
		return card;
	}

	setAssignee(cardId: number, roleId: string | null): void {
		this.db
			.prepare("UPDATE cards SET assignee_role = ?, version = version + 1, updated_at = ? WHERE id = ?")
			.run(roleId, new Date().toISOString(), cardId);
	}

	markBlocked(cardId: number, reason: string): void {
		this.db
			.prepare("UPDATE cards SET status = 'blocked', updated_at = ? WHERE id = ?")
			.run(new Date().toISOString(), cardId);
	}

	unblock(cardId: number): void {
		const now = new Date().toISOString();
		this.db
			.prepare("UPDATE cards SET status = 'ready', holder_id = NULL, updated_at = ? WHERE id = ? AND status = 'blocked'")
			.run(now, cardId);
	}

	/** 验收通过:status=done → Done 列(取第一个 done 列) */
	approveCard(cardId: number): void {
		const doneCol = this.db.prepare("SELECT id FROM columns WHERE done = 1 ORDER BY position LIMIT 1").get() as
			| { id: number }
			| undefined;
		const now = new Date().toISOString();
		this.db
			.prepare("UPDATE cards SET status = 'done', holder_id = NULL, version = version + 1, updated_at = ? WHERE id = ?")
			.run(now, cardId);
		if (doneCol) this.db.prepare("UPDATE cards SET column_id = ? WHERE id = ?").run(doneCol.id, cardId);
	}

	/** 验收驳回:回 ready + 清 holder(原处理角色由调用方 @唤醒) */
	rejectCard(cardId: number): CardRow {
		const now = new Date().toISOString();
		this.db
			.prepare("UPDATE cards SET status = 'ready', holder_id = NULL, version = version + 1, updated_at = ? WHERE id = ?")
			.run(now, cardId);
		const card = this.getCard(cardId);
		if (!card) throw new Error("card not found");
		return card;
	}

	/** 请求评审:置 review 状态 + 清 holder */
	requestReview(cardId: number): void {
		const now = new Date().toISOString();
		this.db
			.prepare("UPDATE cards SET status = 'review', holder_id = NULL, version = version + 1, updated_at = ? WHERE id = ?")
			.run(now, cardId);
	}

	// ---------- stages ----------

	getStages(cardId: number): StageRow[] {
		const rows = this.db.prepare("SELECT * FROM stages WHERE card_id = ? ORDER BY position").all(cardId) as Record<string, unknown>[];
		return rows.map(mapStage);
	}

	/** 认领/绑定时:若当前阶段角色匹配实例,标记 in_progress */
	markCurrentStageInProgress(cardId: number, roleId: string): void {
		const card = this.db.prepare("SELECT stage_idx FROM cards WHERE id = ?").get(cardId) as
			| { stage_idx: number }
			| undefined;
		if (!card) return;
		const stages = this.getStages(cardId);
		if (stages.length === 0) return;
		const idx = card.stage_idx < 0 ? 0 : card.stage_idx;
		const stage = stages[idx];
		if (stage && stage.roleId === roleId && stage.status === "pending") {
			this.db.prepare("UPDATE stages SET status = 'in_progress' WHERE id = ?").run(stage.id);
		}
	}

	/** 释放时:回退未完成的 in_progress 阶段 */
	revertInProgressStages(cardId: number): void {
		this.db.prepare("UPDATE stages SET status = 'pending' WHERE card_id = ? AND status = 'in_progress'").run(cardId);
	}

	/** 完成当前阶段并推进;返回下一个阶段(如有) */
	completeStage(cardId: number, actorInstance: string): StageRow | undefined {
		return this.withTx(() => {
			const card = this.db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId) as Record<string, unknown> | undefined;
			if (!card) throw new Error("card not found");
			const stages = this.getStages(cardId);
			if (stages.length === 0) return undefined;
			// 首次完成(stage_idx=-1)视为完成第一个阶段
			const currentIdx = Number(card.stage_idx) < 0 ? 0 : Number(card.stage_idx);
			const current = stages[currentIdx];
			const now = new Date().toISOString();
			if (current && current.status !== "done") {
				this.db
					.prepare("UPDATE stages SET status = 'done', done_by = ? WHERE id = ?")
					.run(actorInstance, current.id);
			}
			// 有下一阶段才推进并流转;否则清空 assignee(不再流转)
			const next = currentIdx + 1 < stages.length ? stages[currentIdx + 1] : undefined;
			this.db
				.prepare("UPDATE cards SET stage_idx = ?, assignee_role = ?, version = version + 1, updated_at = ? WHERE id = ?")
				.run(next ? currentIdx + 1 : currentIdx, next?.roleId ?? null, now, cardId);
			if (next) {
				// 若存在绑定该角色的列,移入
				const col = this.db.prepare("SELECT id FROM columns WHERE workflow_role = ? LIMIT 1").get(next.roleId) as
					| { id: number }
					| undefined;
				if (col) this.db.prepare("UPDATE cards SET column_id = ? WHERE id = ?").run(col.id, cardId);
			} else {
				// 全部阶段完成:移入第一个不可自由认领的非 done 列(默认 In Review),避免被反复认领
				const reviewCol = this.db
					.prepare("SELECT id FROM columns WHERE claimable = 0 AND done = 0 ORDER BY position LIMIT 1")
					.get() as { id: number } | undefined;
				if (reviewCol) this.db.prepare("UPDATE cards SET column_id = ? WHERE id = ?").run(reviewCol.id, cardId);
			}
			return next;
		});
	}

	// ---------- checklist ----------

	addChecklistItem(cardId: number, text: string): ChecklistRow {
		const position = Number(
			(this.db.prepare("SELECT COUNT(*) AS n FROM checklist_items WHERE card_id = ?").get(cardId) as { n: number }).n,
		);
		this.db
			.prepare("INSERT INTO checklist_items (card_id, text, done, position) VALUES (?, ?, 0, ?)")
			.run(cardId, text, position);
		const row = this.db.prepare("SELECT * FROM checklist_items WHERE id = last_insert_rowid()").get() as
			| Record<string, unknown>
			| undefined;
		if (!row) throw new Error("checklist create failed");
		return mapChecklist(row);
	}

	updateChecklistItem(id: number, done: boolean): void {
		this.db.prepare("UPDATE checklist_items SET done = ? WHERE id = ?").run(done ? 1 : 0, id);
	}

	// ---------- activities ----------

	addActivity(
		cardId: number,
		actorKind: string,
		actorId: string,
		type: string,
		payload: Record<string, unknown> = {},
	): ActivityRow {
		this.db
			.prepare("INSERT INTO activities (card_id, actor_kind, actor_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)")
			.run(cardId, actorKind, actorId, type, JSON.stringify(payload), new Date().toISOString());
		const row = this.db.prepare("SELECT * FROM activities WHERE id = last_insert_rowid()").get() as
			| Record<string, unknown>
			| undefined;
		if (!row) throw new Error("activity create failed");
		return mapActivity(row);
	}

	listActivities(cardId: number, limit = 200): ActivityRow[] {
		const rows = this.db
			.prepare("SELECT * FROM activities WHERE card_id = ? ORDER BY id DESC LIMIT ?")
			.all(cardId, limit) as Record<string, unknown>[];
		return rows.map(mapActivity).reverse();
	}

	// ---------- wake signals ----------

	enqueueWakeSignal(input: {
		targetRoleId: string;
		targetInstanceId?: string | null;
		cardId?: number | null;
		source: string;
		priority?: number;
	}): WakeSignalRow | null {
		const dedupeKey = input.targetInstanceId
			? `inst:${input.targetInstanceId}:${input.cardId ?? ""}:${input.source}`
			: `role:${input.targetRoleId}:${input.cardId ?? ""}:${input.source}`;
		const existing = this.db
			.prepare("SELECT id FROM wake_signals WHERE dedupe_key = ? AND status = 'pending' LIMIT 1")
			.get(dedupeKey) as { id: number } | undefined;
		if (existing) return null;
		this.db
			.prepare(
				"INSERT INTO wake_signals (target_role_id, target_instance_id, card_id, source, priority, status, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
			)
			.run(
				input.targetRoleId,
				input.targetInstanceId ?? null,
				input.cardId ?? null,
				input.source,
				input.priority ?? 0,
				dedupeKey,
				new Date().toISOString(),
			);
		const row = this.db.prepare("SELECT * FROM wake_signals WHERE id = last_insert_rowid()").get() as
			| Record<string, unknown>
			| undefined;
		if (!row) throw new Error("wake signal create failed");
		return mapWakeSignal(row);
	}

	/** 领取属于某实例的 pending 信号(按优先级) */
	takePendingSignal(targetInstanceId: string): WakeSignalRow | null {
		return this.withTx(() => {
			const row = this.db
				.prepare(
					"SELECT * FROM wake_signals WHERE target_instance_id = ? AND status = 'pending' ORDER BY priority DESC, id ASC LIMIT 1",
				)
				.get(targetInstanceId) as Record<string, unknown> | undefined;
			if (!row) return null;
			this.db
				.prepare("UPDATE wake_signals SET status = 'queued', processed_at = ? WHERE id = ?")
				.run(new Date().toISOString(), Number(row.id));
			return mapWakeSignal(row);
		});
	}

	/** 领取角色级 pending 信号并锁定到指定实例 */
	assignPendingSignalToInstance(targetRoleId: string, targetInstanceId: string): WakeSignalRow | null {
		return this.withTx(() => {
			const row = this.db
				.prepare(
					"SELECT * FROM wake_signals WHERE target_role_id = ? AND status = 'pending' ORDER BY priority DESC, id ASC LIMIT 1",
				)
				.get(targetRoleId) as Record<string, unknown> | undefined;
			if (!row) return null;
			this.db
				.prepare("UPDATE wake_signals SET status = 'queued', target_instance_id = ?, processed_at = ? WHERE id = ?")
				.run(targetInstanceId, new Date().toISOString(), Number(row.id));
			return mapWakeSignal(row);
		});
	}

	markSignalDone(id: number): void {
		this.db.prepare("UPDATE wake_signals SET status = 'done', processed_at = ? WHERE id = ?").run(new Date().toISOString(), id);
	}

	/** 复位指向已不存在实例的 queued 信号回 pending */
	resetOrphanedQueuedSignals(liveInstanceIds: Set<string>): void {
		const rows = this.db
			.prepare("SELECT id, target_instance_id FROM wake_signals WHERE status = 'queued'")
			.all() as Array<{ id: number; target_instance_id: string | null }>;
		for (const row of rows) {
			if (!row.target_instance_id || !liveInstanceIds.has(row.target_instance_id)) {
				this.db
					.prepare("UPDATE wake_signals SET status = 'pending', target_instance_id = NULL WHERE id = ?")
					.run(Number(row.id));
			}
		}
	}

	// ---------- roles ----------

	upsertRole(input: {
		id: string;
		name: string;
		kind: string;
		model?: string | null;
		thinkingLevel?: string;
		instanceCount?: number;
		claimPolicy?: Record<string, unknown>;
		mentionPolicy?: Record<string, unknown>;
		roleDir: string;
	}): void {
		this.db
			.prepare(
				`INSERT INTO roles (id, name, kind, model, thinking_level, instance_count, claim_policy, mention_policy, role_dir, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
				   name = excluded.name, kind = excluded.kind, model = excluded.model,
				   thinking_level = excluded.thinking_level, instance_count = excluded.instance_count,
				   claim_policy = excluded.claim_policy, mention_policy = excluded.mention_policy,
				   role_dir = excluded.role_dir, updated_at = excluded.updated_at`,
			)
			.run(
				input.id,
				input.name,
				input.kind,
				input.model ?? null,
				input.thinkingLevel ?? "off",
				input.instanceCount ?? 1,
				JSON.stringify(input.claimPolicy ?? {}),
				JSON.stringify(input.mentionPolicy ?? {}),
				input.roleDir,
				new Date().toISOString(),
			);
	}

	getRole(id: string): RoleRow | undefined {
		const row = this.db.prepare("SELECT * FROM roles WHERE id = ?").get(id) as Record<string, unknown> | undefined;
		return row ? mapRole(row) : undefined;
	}

	listRoles(): RoleRow[] {
		const rows = this.db.prepare("SELECT * FROM roles ORDER BY id").all() as Record<string, unknown>[];
		return rows.map(mapRole);
	}

	// ---------- instances ----------

	upsertInstance(roleId: string, idx: number): InstanceRow {
		const id = `${roleId}-${idx}`;
		const now = new Date().toISOString();
		this.db
			.prepare(
				"INSERT INTO instances (id, role_id, idx, status, queue_len, heartbeat_at) VALUES (?, ?, ?, 'idle', 0, ?) ON CONFLICT(id) DO NOTHING",
			)
			.run(id, roleId, idx, now);
		return this.getInstance(id)!;
	}

	getInstance(id: string): InstanceRow | undefined {
		const row = this.db.prepare("SELECT * FROM instances WHERE id = ?").get(id) as Record<string, unknown> | undefined;
		return row ? mapInstance(row) : undefined;
	}

	listInstances(): InstanceRow[] {
		const rows = this.db.prepare("SELECT * FROM instances ORDER BY role_id, idx").all() as Record<string, unknown>[];
		return rows.map(mapInstance);
	}

	updateInstanceStatus(id: string, status: string, currentCardId: number | null = null): void {
		const now = new Date().toISOString();
		this.db
			.prepare("UPDATE instances SET status = ?, current_card_id = ?, heartbeat_at = ? WHERE id = ?")
			.run(status, currentCardId, now, id);
	}

	heartbeat(id: string): void {
		this.db.prepare("UPDATE instances SET heartbeat_at = ? WHERE id = ?").run(new Date().toISOString(), id);
	}

	setInstanceQueueLen(id: string, queueLen: number): void {
		this.db.prepare("UPDATE instances SET queue_len = ? WHERE id = ?").run(queueLen, id);
	}

	// ---------- usage ----------

	recordUsage(input: {
		roleId?: string | null;
		instanceId?: string | null;
		cardId?: number | null;
		model?: string | null;
		inputTokens?: number;
		outputTokens?: number;
		cacheRead?: number;
		cacheWrite?: number;
		cost?: number;
	}): void {
		this.db
			.prepare(
				"INSERT INTO usage (role_id, instance_id, card_id, model, input_tokens, output_tokens, cache_read, cache_write, cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.run(
				input.roleId ?? null,
				input.instanceId ?? null,
				input.cardId ?? null,
				input.model ?? null,
				input.inputTokens ?? 0,
				input.outputTokens ?? 0,
				input.cacheRead ?? 0,
				input.cacheWrite ?? 0,
				input.cost ?? 0,
				new Date().toISOString(),
			);
	}

	/** 用量汇总:支持按角色/卡片/时间过滤;返回总计 + 按角色分组 */
	usageSummary(input: { roleId?: string; cardId?: number; since?: string }): UsageSummary {
		const clauses: string[] = [];
		const params: (string | number)[] = [];
		if (input.roleId) {
			clauses.push("role_id = ?");
			params.push(input.roleId);
		}
		if (input.cardId !== undefined) {
			clauses.push("card_id = ?");
			params.push(input.cardId);
		}
		if (input.since) {
			clauses.push("created_at >= ?");
			params.push(input.since);
		}
		const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

		const totalRow = this.db
			.prepare(
				`SELECT COUNT(*) AS requests, IFNULL(SUM(input_tokens),0) AS inputTokens,
				 IFNULL(SUM(output_tokens),0) AS outputTokens, IFNULL(SUM(cache_read),0) AS cacheRead,
				 IFNULL(SUM(cache_write),0) AS cacheWrite, IFNULL(SUM(cost),0) AS cost
				 FROM usage ${where}`,
			)
			.get(...params) as Record<string, unknown>;

		const byRoleRows = this.db
			.prepare(
				`SELECT role_id AS roleId, COUNT(*) AS requests, IFNULL(SUM(input_tokens),0) AS inputTokens,
				 IFNULL(SUM(output_tokens),0) AS outputTokens, IFNULL(SUM(cache_read),0) AS cacheRead,
				 IFNULL(SUM(cache_write),0) AS cacheWrite, IFNULL(SUM(cost),0) AS cost
				 FROM usage ${where} GROUP BY role_id ORDER BY cost DESC`,
			)
			.all(...params) as Record<string, unknown>[];

		const map = (r: Record<string, unknown>) => ({
			requests: Number(r.requests),
			inputTokens: Number(r.inputTokens),
			outputTokens: Number(r.outputTokens),
			cacheRead: Number(r.cacheRead),
			cacheWrite: Number(r.cacheWrite),
			cost: Number(r.cost),
		});
		return {
			total: map(totalRow),
			byRole: byRoleRows.map((r) => ({ roleId: String(r.roleId), ...map(r) })),
		};
	}

	// ---------- memory ----------

	appendMemory(input: { roleId: string; content: string; kind?: string; sourceCardId?: number }): void {
		this.db
			.prepare("INSERT INTO memory_entries (role_id, content, kind, source_card_id, created_at) VALUES (?, ?, ?, ?, ?)")
			.run(input.roleId, input.content, input.kind ?? "manual", input.sourceCardId ?? null, new Date().toISOString());
	}

	getMemory(roleId: string): Array<{ content: string; kind: string; createdAt: string }> {
		const rows = this.db
			.prepare("SELECT content, kind, created_at FROM memory_entries WHERE role_id = ? ORDER BY id")
			.all(roleId) as Record<string, unknown>[];
		return rows.map((r) => ({
			content: String(r.content),
			kind: String(r.kind),
			createdAt: String(r.created_at),
		}));
	}
}

export class CardVersionConflict extends Error {
	readonly currentVersion: number;
	constructor(currentVersion: number) {
		super(`card version conflict: current=${currentVersion}`);
		this.currentVersion = currentVersion;
	}
}

export interface UsageSummary {
	total: {
		requests: number;
		inputTokens: number;
		outputTokens: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
	};
	byRole: Array<{
		roleId: string;
		requests: number;
		inputTokens: number;
		outputTokens: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
	}>;
}

function mapColumn(row: Record<string, unknown>): ColumnRow {
	return {
		id: Number(row.id),
		name: String(row.name),
		position: Number(row.position),
		claimable: Number(row.claimable),
		done: Number(row.done),
		workflowRole: row.workflow_role === null ? null : String(row.workflow_role),
	};
}

function mapCard(row: Record<string, unknown>): CardRow {
	let tags: string[] = [];
	try {
		tags = JSON.parse(String(row.tags));
	} catch {
		tags = [];
	}
	return {
		id: Number(row.id),
		title: String(row.title),
		description: String(row.description),
		type: String(row.type),
		priority: Number(row.priority),
		tags,
		columnId: Number(row.column_id),
		status: String(row.status),
		holderId: row.holder_id === null ? null : String(row.holder_id),
		assigneeRole: row.assignee_role === null ? null : String(row.assignee_role),
		stageIdx: Number(row.stage_idx),
		dueAt: row.due_at === null ? null : String(row.due_at),
		reviewApprover: row.review_approver === null ? null : Number(row.review_approver),
		version: Number(row.version),
		createdBy: row.created_by === null ? null : Number(row.created_by),
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}

function mapStage(row: Record<string, unknown>): StageRow {
	return {
		id: Number(row.id),
		cardId: Number(row.card_id),
		roleId: String(row.role_id),
		title: String(row.title),
		description: String(row.description),
		status: String(row.status),
		doneBy: row.done_by === null ? null : String(row.done_by),
		position: Number(row.position),
	};
}

function mapChecklist(row: Record<string, unknown>): ChecklistRow {
	return {
		id: Number(row.id),
		cardId: Number(row.card_id),
		text: String(row.text),
		done: Number(row.done),
		position: Number(row.position),
	};
}

function mapActivity(row: Record<string, unknown>): ActivityRow {
	let payload: Record<string, unknown> = {};
	try {
		payload = JSON.parse(String(row.payload));
	} catch {
		payload = {};
	}
	return {
		id: Number(row.id),
		cardId: Number(row.card_id),
		actorKind: String(row.actor_kind),
		actorId: String(row.actor_id),
		type: String(row.type),
		payload,
		createdAt: String(row.created_at),
	};
}

function mapWakeSignal(row: Record<string, unknown>): WakeSignalRow {
	return {
		id: Number(row.id),
		targetRoleId: String(row.target_role_id),
		targetInstanceId: row.target_instance_id === null ? null : String(row.target_instance_id),
		cardId: row.card_id === null ? null : Number(row.card_id),
		source: String(row.source),
		priority: Number(row.priority),
		status: String(row.status),
		dedupeKey: row.dedupe_key === null ? null : String(row.dedupe_key),
		createdAt: String(row.created_at),
		processedAt: row.processed_at === null ? null : String(row.processed_at),
	};
}

function mapRole(row: Record<string, unknown>): RoleRow {
	let claimPolicy: Record<string, unknown> = {};
	let mentionPolicy: Record<string, unknown> = {};
	try {
		claimPolicy = JSON.parse(String(row.claim_policy));
	} catch {
		claimPolicy = {};
	}
	try {
		mentionPolicy = JSON.parse(String(row.mention_policy));
	} catch {
		mentionPolicy = {};
	}
	return {
		id: String(row.id),
		name: String(row.name),
		kind: String(row.kind),
		model: row.model === null ? null : String(row.model),
		thinkingLevel: String(row.thinking_level),
		instanceCount: Number(row.instance_count),
		claimPolicy,
		mentionPolicy,
		roleDir: String(row.role_dir),
		updatedAt: String(row.updated_at),
	};
}

function mapInstance(row: Record<string, unknown>): InstanceRow {
	return {
		id: String(row.id),
		roleId: String(row.role_id),
		idx: Number(row.idx),
		status: String(row.status),
		currentCardId: row.current_card_id === null ? null : Number(row.current_card_id),
		queueLen: Number(row.queue_len),
		heartbeatAt: String(row.heartbeat_at),
	};
}
