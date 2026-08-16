import { Type } from "typebox";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import type { ExecutionToolContext } from "@earendil-works/pi-agent-core";
import { CardVersionConflict, type BoardDb, type RoleRow } from "../db/board-db";
import type { BusEvent } from "../events/event-bus";
import { appendMemoryFile } from "./memory";

export interface BoardToolContext extends ExecutionToolContext {
	store: BoardDb;
	role: RoleRow;
	instanceId: string;
	emit: (event: BusEvent) => void;
}

export type BoardTool = AgentHarnessTool<BoardToolContext>;

interface ToolCtx extends ExecutionToolContext {
	store: BoardDb;
	role: RoleRow;
	instanceId: string;
	emit: (event: BusEvent) => void;
}

/** 记录活动并广播(card.updated + activity.created) */
function record(ctx: ToolCtx, cardId: number, type: string, payload: Record<string, unknown>): void {
	const activity = ctx.store.addActivity(cardId, "instance", ctx.instanceId, type, payload);
	const card = ctx.store.getCard(cardId);
	ctx.emit({ type: "activity.created", activity });
	if (card) ctx.emit({ type: "card.updated", card });
}

function result(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

function toolError(message: string) {
	return { content: [{ type: "text" as const, text: `ERROR: ${message}` }], details: {}, isError: true as const };
}

/** 实例 scratchpad 文件路径(相对 env.cwd = 看板目录) */
function scratchpadPath(ctx: ToolCtx): string {
	return `.kanban/scratchpads/${ctx.instanceId}.md`;
}

export function createBoardTools(): BoardTool[] {
	const tools: BoardTool[] = [
		{
			name: "board_state",
			label: "Board State",
			description:
				"Get the current kanban board state: columns with card counts, role list, and agent instance statuses. Use this first to understand the board.",
			parameters: Type.Object({
				columns: Type.Optional(Type.Boolean({ description: "Include column details (default true)" })),
				roles: Type.Optional(Type.Boolean({ description: "Include role list (default true)" })),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const columns = c.store.listColumns().map((col) => ({
					id: col.id,
					name: col.name,
					claimable: col.claimable === 1,
					done: col.done === 1,
					workflowRole: col.workflowRole,
					cardCount: c.store.listCards({ columnId: col.id }).length,
				}));
				const roles = c.store.listRoles().map((r) => ({
					id: r.id,
					name: r.name,
					kind: r.kind,
					instanceCount: r.instanceCount,
				}));
				const instances = c.store.listInstances().map((i) => ({
					id: i.id,
					roleId: i.roleId,
					status: i.status,
					currentCardId: i.currentCardId,
					queueLen: i.queueLen,
				}));
				return { content: [{ type: "text", text: JSON.stringify({ columns, roles, instances }, null, 2) }], details: {} };
			},
		},
		{
			name: "list_cards",
			label: "List Cards",
			description:
				"List cards with optional filters (column id, status, assignee role, or only cards assigned to you). Returns card summaries.",
			parameters: Type.Object({
				column: Type.Optional(Type.Integer()),
				status: Type.Optional(Type.String()),
				role: Type.Optional(Type.String({ description: "Assignee role id" })),
				mine: Type.Optional(Type.Boolean({ description: "Only cards assigned to my role" })),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { column?: number; status?: string; role?: string; mine?: boolean };
				const cards = c.store
					.listCards({
						columnId: p.column,
						status: p.status,
						assigneeRole: p.mine ? c.role.id : p.role,
					})
					.map((card) => ({
						id: card.id,
						title: card.title,
						status: card.status,
						columnId: card.columnId,
						priority: card.priority,
						assigneeRole: card.assigneeRole,
						holderId: card.holderId,
					}));
				return { content: [{ type: "text", text: JSON.stringify(cards, null, 2) }], details: {} };
			},
		},
		{
			name: "read_card",
			label: "Read Card",
			description:
				"Read a card in full: description, status, assignee, stages, checklist, and the complete activity timeline. Always call this before working on a card.",
			parameters: Type.Object({
				cardId: Type.Integer(),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { cardId: number };
				const card = c.store.getCard(p.cardId);
				if (!card) return toolError(`card ${p.cardId} not found`);
				const activities = c.store.listActivities(p.cardId);
				return {
					content: [{ type: "text", text: JSON.stringify({ card, activities }, null, 2) }],
					details: {},
				};
			},
		},
		{
			name: "claim_card",
			label: "Claim Card",
			description:
				"Claim a card from a claimable column for your role. Fails if the card is already held or not in a claimable column. Only claim cards you intend to process now.",
			parameters: Type.Object({
				cardId: Type.Integer(),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { cardId: number };
				const ok = c.store.claimCard(p.cardId, c.instanceId);
				if (!ok) {
					return toolError(`cannot claim card ${p.cardId}: already held, not ready, or column not claimable`);
				}
				c.store.updateInstanceStatus(c.instanceId, "working", p.cardId);
				c.emit({ type: "instance.updated", instance: c.store.getInstance(c.instanceId) });
				record(c, p.cardId, "claimed", { instanceId: c.instanceId });
				return result(`claimed card ${p.cardId}`);
			},
		},
		{
			name: "update_card",
			label: "Update Card",
			description:
				"Update card fields (title, description, priority 0-4, tags). Uses optimistic locking; on conflict retry after re-reading.",
			parameters: Type.Object({
				cardId: Type.Integer(),
				title: Type.Optional(Type.String()),
				description: Type.Optional(Type.String()),
				priority: Type.Optional(Type.Integer()),
				tags: Type.Optional(Type.Array(Type.String())),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { cardId: number; title?: string; description?: string; priority?: number; tags?: string[] };
				const current = c.store.getCard(p.cardId);
				if (!current) return toolError(`card ${p.cardId} not found`);
				try {
					const card = c.store.updateCard(
						p.cardId,
						{
							title: p.title,
							description: p.description,
							priority: p.priority,
							tags: p.tags,
						},
						current.version,
					);
					c.emit({ type: "card.updated", card });
					return result(`updated card ${p.cardId}`);
				} catch (error) {
					if (error instanceof CardVersionConflict) {
						return toolError(`card changed concurrently (version ${error.currentVersion}); re-read and retry`);
					}
					throw error;
				}
			},
		},
		{
			name: "comment_card",
			label: "Comment on Card",
			description:
				"Add a comment to the card's activity timeline. You can mention other roles/instances/users with @name to wake or notify them.",
			parameters: Type.Object({
				cardId: Type.Integer(),
				text: Type.String(),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { cardId: number; text: string };
				if (!c.store.getCard(p.cardId)) return toolError(`card ${p.cardId} not found`);
				record(c, p.cardId, "comment", { text: p.text });
				return result(`commented on card ${p.cardId}`);
			},
		},
		{
			name: "complete_stage",
			label: "Complete Stage",
			description:
				"Mark the current stage of the card as done and advance to the next stage. If a next stage exists, the card is assigned to its role and that role is woken. Call this when your role's part is finished.",
			parameters: Type.Object({
				cardId: Type.Integer(),
				summary: Type.Optional(Type.String({ description: "Summary of what was done, posted as a comment" })),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { cardId: number; summary?: string };
				const card = c.store.getCard(p.cardId);
				if (!card) return toolError(`card ${p.cardId} not found`);
				if (p.summary) {
					record(c, p.cardId, "comment", { text: p.summary });
				}
				const next = c.store.completeStage(p.cardId, c.instanceId);
				record(c, p.cardId, "stage_done", { nextRole: next?.roleId ?? null });
				return result(
					next ? `stage completed; card now assigned to role ${next.roleId}` : "stage completed; no more stages defined",
				);
			},
		},
		{
			name: "move_card",
			label: "Move Card",
			description:
				"Move a card to another column. You cannot move a card directly to a done column; use request_review for that.",
			parameters: Type.Object({
				cardId: Type.Integer(),
				columnId: Type.Integer(),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { cardId: number; columnId: number };
				const card = c.store.getCard(p.cardId);
				if (!card) return toolError(`card ${p.cardId} not found`);
				const column = c.store.getColumn(p.columnId);
				if (!column) return toolError(`column ${p.columnId} not found`);
				if (column.done === 1) {
					return toolError("cannot move directly to a done column; use request_review for completion flow");
				}
				const updated = c.store.moveCard(p.cardId, p.columnId);
				c.emit({ type: "card.updated", card: updated });
				record(c, p.cardId, "moved", { columnId: p.columnId, columnName: column.name });
				return result(`moved card ${p.cardId} to ${column.name}`);
			},
		},
		{
			name: "assign_card",
			label: "Assign Card",
			description:
				"Assign the card to another role (set assignee and wake that role to process it).",
			parameters: Type.Object({
				cardId: Type.Integer(),
				roleId: Type.String(),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { cardId: number; roleId: string };
				if (!c.store.getCard(p.cardId)) return toolError(`card ${p.cardId} not found`);
				if (!c.store.getRole(p.roleId)) return toolError(`role ${p.roleId} not found`);
				c.store.setAssignee(p.cardId, p.roleId);
				const card = c.store.getCard(p.cardId)!;
				c.emit({ type: "card.updated", card });
				record(c, p.cardId, "assigned", { roleId: p.roleId });
				return result(`assigned card ${p.cardId} to role ${p.roleId}`);
			},
		},
		{
			name: "request_review",
			label: "Request Review",
			description:
				"Move the card to the In Review column, mark it as awaiting review, and notify the card's review approver. Call when your work is complete and needs human approval.",
			parameters: Type.Object({
				cardId: Type.Integer(),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { cardId: number };
				const card = c.store.getCard(p.cardId);
				if (!card) return toolError(`card ${p.cardId} not found`);
				const reviewCol = c.store
					.listColumns()
					.find((col) => col.claimable === 0 && col.done === 0 && col.name.toLowerCase().includes("review"));
				if (reviewCol) {
					const updated = c.store.moveCard(p.cardId, reviewCol.id);
					c.emit({ type: "card.updated", card: updated });
				}
				c.store.requestReview(p.cardId);
				const updated = c.store.getCard(p.cardId)!;
				c.emit({ type: "card.updated", card: updated });
				record(c, p.cardId, "review_requested", { approverUserId: card.reviewApprover });
				return result(`card ${p.cardId} moved to review; approver notified`);
			},
		},
		{
			name: "add_checklist",
			label: "Add Checklist Item",
			description: "Add a checklist item to a card.",
			parameters: Type.Object({
				cardId: Type.Integer(),
				text: Type.String(),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { cardId: number; text: string };
				if (!c.store.getCard(p.cardId)) return toolError(`card ${p.cardId} not found`);
				c.store.addChecklistItem(p.cardId, p.text);
				const card = c.store.getCard(p.cardId)!;
				c.emit({ type: "card.updated", card });
				return result("checklist item added");
			},
		},
		{
			name: "update_checklist",
			label: "Update Checklist Item",
			description: "Mark a checklist item done or undone.",
			parameters: Type.Object({
				itemId: Type.Integer(),
				done: Type.Boolean(),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { itemId: number; done: boolean };
				c.store.updateChecklistItem(p.itemId, p.done);
				return result("checklist updated");
			},
		},
		{
			name: "mark_blocked",
			label: "Mark Blocked",
			description: "Mark a card as blocked with a reason.",
			parameters: Type.Object({
				cardId: Type.Integer(),
				reason: Type.String(),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { cardId: number; reason: string };
				c.store.markBlocked(p.cardId, p.reason);
				const card = c.store.getCard(p.cardId);
				c.emit({ type: "card.updated", card });
				record(c, p.cardId, "blocked", { reason: p.reason });
				return result(`card ${p.cardId} blocked`);
			},
		},
		{
			name: "unblock",
			label: "Unblock Card",
			description: "Unblock a blocked card, returning it to ready.",
			parameters: Type.Object({
				cardId: Type.Integer(),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { cardId: number };
				c.store.unblock(p.cardId);
				const card = c.store.getCard(p.cardId);
				c.emit({ type: "card.updated", card });
				record(c, p.cardId, "unblocked", {});
				return result(`card ${p.cardId} unblocked`);
			},
		},
		{
			name: "append_memory",
			label: "Append Memory",
			description:
				"Append a note to your role's long-term memory (memory.md). Use sparingly for durable lessons or decisions that future work of this role should know.",
			parameters: Type.Object({
				content: Type.String(),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { content: string };
				c.store.appendMemory({ roleId: c.role.id, content: p.content });
				appendMemoryFile(c.role.roleDir, p.content);
				return result("memory appended");
			},
		},
		{
			name: "read_scratchpad",
			label: "Read Scratchpad",
			description:
				"Read this instance's private scratchpad — notes you saved across cards, not visible to other instances. Use it to recall your own unfinished plans and cross-card learnings.",
			parameters: Type.Object({}),
			execute: async (_toolCallId, _params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const r = await c.env.readTextFile(scratchpadPath(c));
				return { content: [{ type: "text", text: r.ok ? r.value : "(empty scratchpad)" }], details: {} };
			},
		},
		{
			name: "append_scratchpad",
			label: "Append Scratchpad",
			description:
				"Append a note to this instance's private scratchpad (not visible to other instances). Use it for unfinished plans and personal context across cards.",
			parameters: Type.Object({
				content: Type.String(),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
				const c = context as ToolCtx;
				const p = params as { content: string };
				const line = `- (${new Date().toISOString().slice(0, 10)}) ${p.content.replace(/\n/g, " ").trim()}\n`;
				const r = await c.env.appendFile(scratchpadPath(c), line);
				return result(r.ok ? "scratchpad appended" : "scratchpad append failed");
			},
		},
	];

	return tools;
}
