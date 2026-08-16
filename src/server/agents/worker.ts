import {
	AgentHarness,
	type AgentMessage,
	createEditTool,
	createReadTool,
	createWriteTool,
	type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { Model } from "@earendil-works/pi-ai";
import type { BoardRuntime } from "../runtime";
import type { RoleRow } from "../db/board-db";
import { createBoardTools, type BoardToolContext } from "./board-tools";
import { createSafeBashTool } from "./safety";
import { compactMemoryFile } from "./memory";
import { loadRoleResources } from "./resources";
import { buildRoleSystemPrompt, describeTools } from "./system-prompt";

export interface WorkerTask {
	source: "assign" | "mention" | "manual" | "claim";
	cardId: number;
	message?: string;
	signalId?: number;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const THINKING_LEVELS: ThinkingLevel[] = ["off", "low", "medium", "high"];

/**
 * 实例 Worker:一次只处理一张卡片。
 * 任务来源优先级: 内存队列(assign/mention/manual) > DB 指向本实例的信号 > DB 角色级信号 > 自由认领扫描。
 */
export class InstanceWorker {
	private stopped = false;
	busy = false;
	private queue: WorkerTask[] = [];
	/** 当前处理的卡片 */
	currentCardId: number | null = null;
	/** 最近处理过的卡片(直聊 instance 源 fork 用,释放后保留) */
	lastCardId: number | null = null;
	private sleepResolver: (() => void) | undefined;
	/** 直聊模式:不处理卡片任务 */
	chatting = false;
	/** 模型不可用等故障时的认领退避截止时间 */
	private backoffUntil = 0;
	private lastHeartbeat = 0;

	constructor(
		private runtime: BoardRuntime,
		readonly role: RoleRow,
		readonly instanceId: string,
	) {}

	private activeHarness: AgentHarness<BoardToolContext> | undefined;

	start(): void {
		void this.runLoop();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.poke();
		while (this.busy) {
			await sleep(200);
		}
	}

	/** 立即唤醒检查(人工/提及/指派人机都可调用) */
	poke(): void {
		this.sleepResolver?.();
	}

	enqueue(task: WorkerTask): void {
		this.queue.push(task);
		this.queue.sort((a, b) => priorityOf(b.source) - priorityOf(a.source));
		this.poke();
	}

	async abort(): Promise<void> {
		this.activeHarness?.abort();
		this.poke();
	}

	private async runLoop(): Promise<void> {
		while (!this.stopped) {
			try {
				// 周期心跳(存活信号)
				if (Date.now() - this.lastHeartbeat > 30_000) {
					this.runtime.store.heartbeat(this.instanceId);
					this.lastHeartbeat = Date.now();
				}
				if (this.busy || this.chatting) {
					await sleep(500);
					continue;
				}
				const task = await this.nextTask();
				if (!task) {
					await this.pause(this.runtime.config.scanIntervalMs);
					continue;
				}
				this.busy = true;
				try {
					await this.work(task);
				} catch (error) {
					console.error(`[pipipi] worker ${this.instanceId} work error:`, error);
					try {
						this.runtime.store.addActivity(task.cardId, "instance", this.instanceId, "error", {
							message: error instanceof Error ? error.message : String(error),
						});
					} catch {}
				} finally {
					this.busy = false;
					// 避免空转:每次 work 后至少停 2s
					await this.pause(2_000);
				}
			} catch (error) {
				// nextTask 等循环级错误:记录并继续
				console.error(`[pipipi] worker ${this.instanceId} loop error:`, error);
				await this.pause(5_000);
			}
		}
	}

	private pause(ms: number): Promise<void> {
		return new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				this.sleepResolver = undefined;
				resolve();
			}, ms);
			this.sleepResolver = () => {
				clearTimeout(timer);
				this.sleepResolver = undefined;
				resolve();
			};
		});
	}

	private async nextTask(): Promise<WorkerTask | undefined> {
		const store = this.runtime.store;
		// 1. 内存队列(assign/mention/manual)
		const queued = this.queue.shift();
		if (queued) return queued;
		// 2. DB 中指向本实例的信号
		const mine = store.takePendingSignal(this.instanceId);
		if (mine && mine.cardId != null) {
			return { source: mine.source as WorkerTask["source"], cardId: mine.cardId, signalId: mine.id };
		}
		// 3. DB 角色级信号(assign/mention 未绑定实例)
		const roleSignal = store.assignPendingSignalToInstance(this.role.id, this.instanceId);
		if (roleSignal && roleSignal.cardId != null) {
			return { source: roleSignal.source as WorkerTask["source"], cardId: roleSignal.cardId, signalId: roleSignal.id };
		}
		// 4. 自由认领扫描(退避期内跳过,避免模型故障时空转)
		if (Date.now() < this.backoffUntil) return undefined;
		return this.scanClaim();
	}

	private async scanClaim(): Promise<WorkerTask | undefined> {
		const store = this.runtime.store;
		const candidates = store
			.listCards({ status: "ready" })
			.filter((card) => {
				// 已指派给其他角色的卡片不参与自由认领(等 assign 唤醒)
				if (card.assigneeRole && card.assigneeRole !== this.role.id) return false;
				const column = store.getColumn(card.columnId);
				return column?.claimable === 1;
			})
			.sort((a, b) => claimScore(b) - claimScore(a))
			.slice(0, 3);
		for (const card of candidates) {
			if (store.claimCard(card.id, this.instanceId)) {
				return { source: "claim", cardId: card.id };
			}
		}
		return undefined;
	}

	private async work(task: WorkerTask): Promise<void> {
		const store = this.runtime.store;
		const card = store.getCard(task.cardId);
		if (!card) {
			this.finishSignal(task);
			return;
		}
		if (task.source !== "claim") {
			const bound = store.bindCard(task.cardId, this.instanceId);
			if (!bound) {
				// 卡片仍被占用(如上一角色尚未释放):信号重新入队,稍后重试
				store.enqueueWakeSignal({
					targetRoleId: this.role.id,
					targetInstanceId: this.instanceId,
					cardId: task.cardId,
					source: task.source,
					priority: priorityOf(task.source),
				});
				this.finishSignal(task);
				await this.pause(3_000);
				return;
			}
		}
		this.currentCardId = task.cardId;
		this.lastCardId = task.cardId;
		store.updateInstanceStatus(this.instanceId, "working", task.cardId);
		this.runtime.bus.emit({
			type: "instance.updated",
			instance: store.getInstance(this.instanceId),
		});
		store.setCardInProgress(task.cardId);
		store.markCurrentStageInProgress(task.cardId, this.role.id);
		store.addActivity(task.cardId, "instance", this.instanceId, "claimed", { source: task.source });
		const activity = store.listActivities(task.cardId).at(-1);
		if (activity) this.runtime.bus.emit({ type: "activity.created", activity });

		let harness: AgentHarness<BoardToolContext> | undefined;
		try {
			const model = this.resolveModel();
			if (!model) {
				this.backoffUntil = Date.now() + 60_000;
				store.addActivity(task.cardId, "instance", this.instanceId, "error", {
					message: `role ${this.role.id} has no resolvable model (${this.role.model ?? "(none)"})`,
				});
				return;
			}
			harness = await this.createHarness(model, task.cardId);
			this.activeHarness = harness;
			const instruction = this.buildTaskInstruction(task, card);
			const result = await harness.prompt(instruction);
			await harness.waitForIdle();
			this.recordUsage(result, task.cardId);
			// memory.md 超限压缩(异步,尽力而为)
			if (this.role.roleDir) {
				void compactMemoryFile(this.role.roleDir, this.runtime.models, model)
					.then((compacted) => {
						if (compacted) console.log(`[pipipi] compacted memory for role ${this.role.id}`);
					})
					.catch((error) => console.error(`[pipipi] memory compact failed for ${this.role.id}:`, error));
			}
		} finally {
			this.activeHarness = undefined;
			store.revertInProgressStages(task.cardId);
			this.currentCardId = null;
			store.releaseCard(task.cardId);
			store.updateInstanceStatus(this.instanceId, "idle");
			this.runtime.bus.emit({
				type: "instance.updated",
				instance: store.getInstance(this.instanceId),
			});
			this.finishSignal(task);
		}
	}

	private finishSignal(task: WorkerTask): void {
		if (task.signalId != null) {
			this.runtime.store.markSignalDone(task.signalId);
		}
	}

	resolveModel(): Model<any> | undefined {
		const spec = this.role.model;
		if (!spec) return undefined;
		const slash = spec.indexOf("/");
		if (slash < 0) return undefined;
		const provider = spec.slice(0, slash);
		const id = spec.slice(slash + 1);
		const model = this.runtime.models.getModel(provider, id);
		if (!model) {
			const available = this.runtime.models.getModels(provider).map((m) => m.id);
			console.error(
				`[pipipi] role ${this.role.id}: model "${spec}" not found. Available: ${available.slice(0, 10).join(", ")}`,
			);
		}
		return model;
	}

	private async createHarness(model: Model<any>, cardId: number): Promise<AgentHarness<BoardToolContext>> {
		const runtime = this.runtime;
		const resources = await loadRoleResources(this.role.roleDir, runtime.dir);
		const env = new NodeExecutionEnv({ cwd: runtime.dir });
		const boardTools = createBoardTools();
		const fileTools = [
			createReadTool(),
			createWriteTool(),
			createEditTool(),
			createSafeBashTool(),
		];
		const allTools = [...boardTools, ...fileTools];
		const toolContext = (): BoardToolContext => ({
			env,
			store: runtime.store,
			role: this.role,
			instanceId: this.instanceId,
			emit: (event) => runtime.bus.emit(event),
		});
		const systemPrompt = buildRoleSystemPrompt({
			role: this.role,
			agentMd: resources.agentMd,
			memoryMd: resources.memoryMd,
			appendMd: resources.appendMd,
			skills: resources.skills,
			boardToolDescriptions: describeTools(boardTools),
			workCwd: runtime.dir,
			boardName: runtime.boardName,
		});
		const harness = new AgentHarness<BoardToolContext>({
			session: await runtime.openCardSession(cardId),
			models: runtime.models,
			model,
			thinkingLevel: this.thinkingLevel(),
			tools: allTools,
			toolContext,
			resources: { skills: resources.skills, promptTemplates: resources.promptTemplates },
			systemPrompt,
			streamOptions: { cacheRetention: "long" },
		});
		harness.subscribe((event) => {
			if (event.type === "message_update") {
				const message = event.message;
				if (message && message.role === "assistant") {
					runtime.bus.emit({
						type: "agent.stream",
						cardId,
						instanceId: this.instanceId,
						event: {
							type: "message_update",
							message: { role: message.role, content: message.content },
						},
					});
				}
			}
			// 重试/错误事件 → 实例流(错误重试可视化)
			if (event.type === "retry_scheduled") {
				runtime.bus.emit({
					type: "agent.retry",
					instanceId: this.instanceId,
					event: {
						type: "retry_scheduled",
						operation: event.operation,
						attempt: event.attempt,
						maxAttempts: event.maxAttempts,
						delayMs: event.delayMs,
						errorMessage: event.errorMessage,
					},
				});
			}
			if (event.type === "retry_attempt_start") {
				runtime.bus.emit({
					type: "agent.retry",
					instanceId: this.instanceId,
					event: { type: "retry_attempt_start", operation: event.operation },
				});
			}
			if (event.type === "retry_finished") {
				runtime.bus.emit({
					type: "agent.retry",
					instanceId: this.instanceId,
					event: { type: "retry_finished", operation: event.operation },
				});
			}
		});
		return harness;
	}

	private thinkingLevel(): ThinkingLevel {
		const level = this.role.thinkingLevel as ThinkingLevel;
		return THINKING_LEVELS.includes(level) ? level : "off";
	}

	private buildTaskInstruction(task: WorkerTask, card: { id: number; title: string; status: string }): string {
		const sourceLabel: Record<WorkerTask["source"], string> = {
			assign: "you were assigned this card",
			mention: "you were mentioned on this card",
			manual: "a user woke you up for this card",
			claim: "you claimed this card",
		};
		const lines: string[] = [
			`Task on kanban board "${this.runtime.boardName}": "${card.title}" (card #${card.id})`,
			`Trigger: ${sourceLabel[task.source]}.`,
			`Your role: ${this.role.name} (${this.role.id}).`,
			"",
			"Instructions:",
			"1. Call read_card to load the full card (description, checklist, stages, activity timeline).",
			"2. Perform your part of the work (files, research, writing).",
			"3. Update the board: comment_card with a summary of what you did; complete_stage when your stage is done; request_review when your work is ready for human approval.",
			"4. Use @mentions to hand off to other roles or notify users when needed.",
		];
		if (task.message) {
			lines.push("", `User message: ${task.message}`);
		}
		lines.push("", "Begin.");
		return lines.join("\n");
	}

	private recordUsage(message: AgentMessage, cardId: number): void {
		if (message.role !== "assistant") return;
		const usage = message.usage;
		if (!usage) return;
		this.runtime.store.recordUsage({
			roleId: this.role.id,
			instanceId: this.instanceId,
			cardId,
			model: this.role.model,
			inputTokens: usage.input,
			outputTokens: usage.output,
			cacheRead: usage.cacheRead,
			cacheWrite: usage.cacheWrite,
			cost: usage.cost?.total,
		});
	}
}

function priorityOf(source: WorkerTask["source"]): number {
	switch (source) {
		case "assign":
			return 2;
		case "mention":
		case "manual":
			return 1;
		case "claim":
			return 0;
	}
}

function claimScore(card: { priority: number; createdAt: string }): number {
	const ageHours = (Date.now() - new Date(card.createdAt).getTime()) / 3_600_000;
	return card.priority * 10 + ageHours * 0.5 + Math.random();
}
