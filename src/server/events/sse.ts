import type { BusEvent, EventBus } from "./event-bus.ts";

const encoder = new TextEncoder();

interface SseClient {
	enqueue: (bytes: Uint8Array) => void;
}

/**
 * SSE Hub:每目录一个;把 EventBus 事件广播到连接中的流。
 * 连接即由客户端先 GET /board 拉快照,事件只推增量。
 */
export class SseHub {
	private clients = new Set<SseClient>();
	private unsubscribe: () => void;

	constructor(bus: EventBus, private filter?: (event: BusEvent) => boolean) {
		this.unsubscribe = bus.subscribe((event) => {
			if (this.filter && !this.filter(event)) return;
			this.broadcast(event);
		});
	}

	broadcast(data: unknown): void {
		const bytes = encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
		for (const client of this.clients) {
			try {
				client.enqueue(bytes);
			} catch {
				this.clients.delete(client);
			}
		}
	}

	/** Next.js SSE route 用:返回一个 ReadableStream,并在断开时清理 */
	stream(): ReadableStream<Uint8Array> {
		let cleanup: (() => void) | null = null;
		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				const client: SseClient = {
					enqueue: (bytes) => controller.enqueue(bytes),
				};
				this.clients.add(client);
				const ping = setInterval(() => {
					try {
						controller.enqueue(encoder.encode(": ping\n\n"));
					} catch {
						clearInterval(ping);
					}
				}, 30_000);
				cleanup = () => {
					this.clients.delete(client);
					clearInterval(ping);
				};
			},
			cancel: () => {
				cleanup?.();
			},
		});
		return stream;
	}

	dispose(): void {
		this.unsubscribe();
	}
}
