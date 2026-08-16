import type { BoardRuntime } from "../runtime";
import type { BusEvent } from "../events/event-bus";
import type { ActivityRow } from "../db/board-db";

/**
 * 每目录调度器:订阅事件 → 生成唤醒信号 → 路由到实例;定时兜底(过期认领回收、
 * 孤儿信号复位、实例监督)。
 */
export class Orchestrator {
	private timer: NodeJS.Timeout | undefined;

	constructor(private runtime: BoardRuntime) {
		this.runtime.bus.subscribe((event) => {
			try {
				this.handle(event);
			} catch (error) {
				console.error("[pipipi] orchestrator handler error:", error);
			}
		});
	}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			void this.sweep();
		}, this.runtime.config.scanIntervalMs);
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}

	private handle(event: BusEvent): void {
		switch (event.type) {
			case "activity.created":
				this.onActivity(event.activity as ActivityRow);
				break;
			default:
				break;
		}
	}

	private onActivity(activity: ActivityRow): void {
		switch (activity.type) {
			case "comment": {
				const text = activity.payload?.text;
				if (typeof text === "string") {
					void this.runtime.applyMentions(text, activity.cardId);
				}
				break;
			}
			case "stage_done": {
				const nextRole = activity.payload?.nextRole;
				if (typeof nextRole === "string" && nextRole.length > 0) {
					this.wakeRole(nextRole, activity.cardId, "assign");
				}
				break;
			}
			case "assigned": {
				const roleId = activity.payload?.roleId;
				if (typeof roleId === "string") {
					this.wakeRole(roleId, activity.cardId, "assign");
				}
				break;
			}
			case "review_requested":
				this.notifyReviewer(activity.cardId);
				break;
			case "rejected": {
				const roleId = activity.payload?.roleId;
				if (typeof roleId === "string") {
					this.wakeRole(roleId, activity.cardId, "mention");
				}
				break;
			}
			default:
				break;
		}
	}

	/** 唤醒角色:入 DB 信号(去重)→ 广播 → 路由到空闲实例 */
	wakeRole(roleId: string, cardId: number, source: "assign" | "mention"): void {
		const store = this.runtime.store;
		const role = store.getRole(roleId);
		if (!role || role.kind !== "agent") return;
		const priority = source === "assign" ? 2 : 1;
		const signal = store.enqueueWakeSignal({ targetRoleId: roleId, cardId, source, priority });
		if (signal) {
			this.runtime.bus.emit({ type: "wake.created", signal });
		}
		this.runtime.agentHost.wakeRole(roleId, { cardId, source });
	}

	private notifyReviewer(cardId: number): void {
		const store = this.runtime.store;
		const card = store.getCard(cardId);
		if (!card?.reviewApprover) return;
		const user = this.runtime.globalDb.getUserById(card.reviewApprover);
		if (!user) return;
		const notification = this.runtime.globalDb.createNotification({
			userId: user.id,
			type: "review_request",
			dir: this.runtime.dir,
			cardId,
		});
		this.runtime.bus.emit({ type: "notification.created", notification });
	}

	private async sweep(): Promise<void> {
		try {
			const store = this.runtime.store;
			const reaped = store.reapStaleClaims(this.runtime.config.claimTtlMs);
			if (reaped > 0) {
				console.warn(`[pipipi] swept ${reaped} stale claims in ${this.runtime.boardName}`);
			}
			store.resetOrphanedQueuedSignals(new Set(this.runtime.agentHost.liveInstanceIds()));
			await this.runtime.agentHost.ensureInstances();
		} catch (error) {
			console.error("[pipipi] sweep error:", error);
		}
	}
}
