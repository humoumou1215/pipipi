import type { BoardRuntime } from "../runtime";
import { SseHub } from "../events/sse";
import { InstanceWorker, type WorkerTask } from "./worker";
import { ChatSession, type ChatSource } from "./chat";

/** 每目录 Agent 实例管理器:按角色 instanceCount 启停 worker,负责唤醒路由与直聊 */
export class AgentHost {
	private workers = new Map<string, InstanceWorker>();
	private roundRobin = new Map<string, number>();
	private instanceHubs = new Map<string, SseHub>();
	private chats = new Map<string, ChatSession>();

	constructor(private runtime: BoardRuntime) {}

	async ensureInstances(): Promise<void> {
		const store = this.runtime.store;
		for (const role of store.listRoles()) {
			if (role.kind !== "agent") continue;
			const count = Math.max(1, role.instanceCount);
			for (let idx = 0; idx < count; idx++) {
				const instanceId = `${role.id}-${idx}`;
				store.upsertInstance(role.id, idx);
				if (!this.workers.has(instanceId)) {
					const worker = new InstanceWorker(this.runtime, role, instanceId);
					this.workers.set(instanceId, worker);
					// 实例级 SSE:只推本实例的流式消息与状态
					this.instanceHubs.set(
						instanceId,
						new SseHub(this.runtime.bus, (event) => {
							if (event.type === "agent.stream" && event.instanceId === instanceId) return true;
							if (event.type === "agent.retry" && event.instanceId === instanceId) return true;
							if (event.type === "instance.updated") {
								const inst = event.instance as { id?: string } | undefined;
								return inst?.id === instanceId;
							}
							return false;
						}),
					);
					worker.start();
				}
			}
		}
		// 清理角色实例数缩小的多余 worker
		for (const [instanceId, worker] of [...this.workers]) {
			const role = store.getRole(worker.role.id);
			const idx = Number(instanceId.slice(instanceId.lastIndexOf("-") + 1));
			if (!role || role.kind !== "agent" || idx >= Math.max(1, role.instanceCount)) {
				await worker.stop();
				this.workers.delete(instanceId);
				this.instanceHubs.get(instanceId)?.dispose();
				this.instanceHubs.delete(instanceId);
			}
		}
	}

	getWorker(instanceId: string): InstanceWorker | undefined {
		return this.workers.get(instanceId);
	}

	/** 实例级 SSE hub */
	getInstanceHub(instanceId: string): SseHub | undefined {
		return this.instanceHubs.get(instanceId);
	}

	// ---------- 直聊 ----------

	/** 开始直聊:实例进入 chat 状态,不再处理卡片任务 */
	async startChat(instanceId: string, source: ChatSource): Promise<ChatSession> {
		const worker = this.workers.get(instanceId);
		if (!worker) throw new Error("instance not found");
		if (worker.busy) throw new Error(`instance ${instanceId} is working on card #${worker.currentCardId}`);
		const existing = this.chats.get(instanceId);
		if (existing) return existing;
		// instance 源:回退到该实例最近处理过的卡片会话(如有),否则空白
		const resolved: ChatSource =
			source.kind === "instance" && worker.lastCardId != null
				? { kind: "card", cardId: worker.lastCardId }
				: source;
		const chat = new ChatSession(this.runtime, worker.role, instanceId, () => worker.resolveModel());
		await chat.start(resolved);
		this.chats.set(instanceId, chat);
		worker.chatting = true;
		this.runtime.store.updateInstanceStatus(instanceId, "chat");
		this.runtime.bus.emit({
			type: "instance.updated",
			instance: this.runtime.store.getInstance(instanceId),
		});
		return chat;
	}

	getChat(instanceId: string): ChatSession | undefined {
		return this.chats.get(instanceId);
	}

	/** 结束直聊:实例恢复空闲,可继续认领卡片 */
	async endChat(instanceId: string): Promise<void> {
		const chat = this.chats.get(instanceId);
		if (!chat) return;
		await chat.end();
		this.chats.delete(instanceId);
		const worker = this.workers.get(instanceId);
		if (worker) {
			worker.chatting = false;
			worker.poke();
		}
		this.runtime.store.updateInstanceStatus(instanceId, "idle");
		this.runtime.bus.emit({
			type: "instance.updated",
			instance: this.runtime.store.getInstance(instanceId),
		});
	}

	liveInstanceIds(): string[] {
		return [...this.workers.keys()];
	}

	/** 挑选角色下的空闲实例(轮询) */
	pickIdleInstance(roleId: string): InstanceWorker | undefined {
		const idle = [...this.workers.values()].filter((w) => {
			if (w.role.id !== roleId) return false;
			return this.runtime.store.getInstance(w.instanceId)?.status === "idle";
		});
		if (idle.length === 0) return undefined;
		const cursor = this.roundRobin.get(roleId) ?? 0;
		this.roundRobin.set(roleId, cursor + 1);
		return idle[cursor % idle.length];
	}

	/** 唤醒角色:有空闲实例则绑定 pending 信号并立即入队;否则信号留 DB,worker 空闲时轮询领取 */
	wakeRole(roleId: string, task: { cardId: number; source: WorkerTask["source"]; message?: string }): void {
		const worker = this.pickIdleInstance(roleId);
		if (!worker) return;
		const signal = this.runtime.store.assignPendingSignalToInstance(roleId, worker.instanceId);
		if (signal) {
			worker.enqueue({ source: task.source, cardId: task.cardId, message: task.message, signalId: signal.id });
		}
	}

	/** 直接唤醒指定实例 */
	wakeInstance(instanceId: string, task: { cardId: number; message?: string; source?: WorkerTask["source"] }): void {
		this.workers
			.get(instanceId)
			?.enqueue({ source: task.source ?? "manual", cardId: task.cardId, message: task.message });
	}
}
