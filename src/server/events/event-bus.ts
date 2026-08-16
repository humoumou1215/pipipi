export type BusEvent =
	| { type: "card.created"; card: unknown }
	| { type: "card.updated"; card: unknown }
	| { type: "card.moved"; card: unknown }
	| { type: "activity.created"; activity: unknown }
	| { type: "instance.updated"; instance: unknown }
	| { type: "wake.created"; signal: unknown }
	| { type: "notification.created"; notification: unknown }
	| { type: "agent.stream"; cardId: number; instanceId: string; event: unknown }
	| { type: "agent.retry"; instanceId: string; event: unknown }
	| { type: "chat.message"; chatId: string; message: unknown };

export type BusListener = (event: BusEvent) => void;

/** 每目录一个 EventBus */
export class EventBus {
	private listeners = new Set<BusListener>();

	subscribe(listener: BusListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(event: BusEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (error) {
				console.error("[pipipi] event listener error:", error);
			}
		}
	}
}
