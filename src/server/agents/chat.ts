import {
	AgentHarness,
	createBashTool,
	createEditTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { Model } from "@earendil-works/pi-ai";
import { EventBus } from "../events/event-bus";
import { SseHub } from "../events/sse";
import type { BoardRuntime } from "../runtime";
import type { RoleRow } from "../db/board-db";
import { createBoardTools, type BoardToolContext } from "./board-tools";
import { loadRoleResources } from "./resources";
import { buildRoleSystemPrompt, describeTools } from "./system-prompt";

export type ChatSource = { kind: "card"; cardId: number } | { kind: "blank" } | { kind: "instance" };

let chatSeq = 0;

/**
 * 实例直聊会话:fork 出的独立会话,不写回卡片主会话、不进入看板主流程。
 * 实例在 chat 状态下不认领卡片任务(由 worker.chatting 保证)。
 */
export class ChatSession {
	readonly chatId: string;
	readonly bus: EventBus;
	readonly hub: SseHub;
	private harness: AgentHarness<BoardToolContext> | undefined;
	private prompting = false;

	constructor(
		private runtime: BoardRuntime,
		private role: RoleRow,
		private instanceId: string,
		private resolveModel: () => Model<any> | undefined,
	) {
		this.chatId = `chat-${Date.now().toString(36)}-${++chatSeq}`;
		this.bus = new EventBus();
		this.hub = new SseHub(this.bus);
	}

	get isActive(): boolean {
		return this.harness !== undefined;
	}

	/** 打开会话:按 source fork(卡片/空白)并装配 harness */
	async start(source: ChatSource): Promise<void> {
		if (this.harness) return;
		const model = this.resolveModel();
		if (!model) throw new Error(`role ${this.role.id} has no resolvable model (${this.role.model ?? "(none)"})`);
		const session =
			source.kind === "card"
				? await this.forkCardSession(source.cardId)
				: await this.runtime.sessionRepo.create({
						cwd: this.runtime.dir,
						metadata: { chat: true, chatId: this.chatId, board: this.runtime.boardName },
					});
		this.harness = await this.buildHarness(model, session);
	}

	/** 发送消息:忙碌时走 steer 队列,空闲时直接 prompt */
	async message(text: string): Promise<void> {
		const harness = this.harness;
		if (!harness) throw new Error("chat not started");
		if (this.prompting) {
			await harness.steer(text);
			return;
		}
		this.prompting = true;
		try {
			const result = await harness.prompt(text);
			await harness.waitForIdle();
			this.recordUsage(result);
		} finally {
			this.prompting = false;
		}
	}

	/** 结束:中止活动 run,丢弃 harness(会话已按消息持久化) */
	async end(): Promise<void> {
		if (this.harness) {
			this.harness.abort().catch(() => {});
			this.harness = undefined;
		}
	}

	private async forkCardSession(cardId: number): Promise<Awaited<ReturnType<BoardRuntime["sessionRepo"]["open"]>>> {
		const metas = await this.runtime.sessionRepo.list({ cwd: this.runtime.dir });
		const meta = metas.find((m) => (m.metadata as { cardId?: number } | undefined)?.cardId === cardId);
		if (!meta) {
			throw new Error(`card ${cardId} has no session yet; have an agent work on it first`);
		}
		return this.runtime.sessionRepo.fork(meta, {
			cwd: this.runtime.dir,
			metadata: { chat: true, chatId: this.chatId, forkOf: cardId },
		});
	}

	private async buildHarness(
		model: Model<any>,
		session: Awaited<ReturnType<BoardRuntime["sessionRepo"]["open"]>>,
	): Promise<AgentHarness<BoardToolContext>> {
		const resources = await loadRoleResources(this.role.roleDir, this.runtime.dir);
		const env = new NodeExecutionEnv({ cwd: this.runtime.dir });
		const boardTools = createBoardTools();
		const allTools = [...boardTools, createReadTool(), createWriteTool(), createEditTool(), createBashTool()];
		const toolContext = (): BoardToolContext => ({
			env,
			store: this.runtime.store,
			role: this.role,
			instanceId: this.instanceId,
			emit: (event) => this.runtime.bus.emit(event),
		});
		const systemPrompt = buildRoleSystemPrompt({
			role: this.role,
			agentMd: resources.agentMd,
			memoryMd: resources.memoryMd,
			appendMd: resources.appendMd,
			skills: resources.skills,
			boardToolDescriptions: describeTools(boardTools),
			workCwd: this.runtime.dir,
			boardName: this.runtime.boardName,
		});
		const harness = new AgentHarness<BoardToolContext>({
			session,
			models: this.runtime.models,
			model,
			thinkingLevel: (this.role.thinkingLevel as "off" | "low" | "medium" | "high") ?? "off",
			tools: allTools,
			toolContext,
			resources: { skills: resources.skills },
			systemPrompt,
			streamOptions: { cacheRetention: "long" },
		});
		harness.subscribe((event) => {
			if (event.type === "message_update" && event.message) {
				const message = event.message;
				if (message.role === "assistant") {
					this.bus.emit({
						type: "chat.message",
						chatId: this.chatId,
						message: { role: message.role, content: message.content },
					});
				}
			}
		});
		return harness;
	}

	private recordUsage(message: { usage?: unknown }): void {
		const usage = message.usage as
			| { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } }
			| undefined;
		if (!usage) return;
		this.runtime.store.recordUsage({
			roleId: this.role.id,
			instanceId: this.instanceId,
			model: this.role.model,
			inputTokens: usage.input,
			outputTokens: usage.output,
			cacheRead: usage.cacheRead,
			cacheWrite: usage.cacheWrite,
			cost: usage.cost?.total,
		});
	}
}
