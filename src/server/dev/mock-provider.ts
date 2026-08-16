import {
	createAssistantMessageEventStream,
	createProvider,
	type AssistantMessage,
	type Context,
	type Model,
	type ProviderStreams,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { envApiKeyAuth } from "@earendil-works/pi-ai";

/**
 * 开发用 mock provider(环境变量 PIPIPI_MOCK_PROVIDER=1 时启用)。
 *
 * 行为:按工具结果轮数返回固定脚本——
 *   第 0 轮:调用 read_card(cardId=1)
 *   第 1 轮:调用 comment_card(cardId=1, "Mock agent finished... @admin please review")
 *   后续:纯文本 "Done. The login bug is fixed."
 * 用于在无真实 API key 环境下验证 Agent 工具循环(读卡片→评论→结束)。
 */
export function createMockProvider() {
	return createProvider({
		id: "mock",
		name: "Mock (dev)",
		auth: { apiKey: envApiKeyAuth("Mock API key", ["MOCK_API_KEY"]) },
		models: [
			{
				id: "mock-model",
				name: "Mock Model",
				api: "mock-api",
				provider: "mock",
				baseUrl: "mock://local",
				reasoning: false,
				input: [],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 4096,
			},
		],
		api: mockApi(),
	});
}

function mockApi(): ProviderStreams {
	const streamSimple = (model: Model<any>, context: Context, _options?: SimpleStreamOptions) => {
		const stream = createAssistantMessageEventStream();
		const toolRounds = context.messages.filter((m) => m.role === "toolResult").length;
		let message: AssistantMessage;
		if (toolRounds === 0) {
			message = withUsage(model, {
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "mock-call-1",
						name: "read_card",
						arguments: { cardId: 1 },
					},
				],
				stopReason: "toolUse",
			});
		} else if (toolRounds === 1) {
			message = withUsage(model, {
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "mock-call-2",
						name: "comment_card",
						arguments: { cardId: 1, text: "Mock agent finished the task. @admin please review." },
					},
				],
				stopReason: "toolUse",
			});
		} else {
			message = withUsage(model, {
				role: "assistant",
				content: [{ type: "text", text: "Done. The login bug is fixed." }],
				stopReason: "stop",
			});
		}

		queueMicrotask(() => {
			stream.push({ type: "start", partial: message });
			message.content.forEach((block, contentIndex) => {
				if (block.type === "text") {
					stream.push({ type: "text_start", contentIndex, partial: message });
					stream.push({ type: "text_delta", contentIndex, delta: block.text, partial: message });
					stream.push({ type: "text_end", contentIndex, content: block.text, partial: message });
				} else if (block.type === "toolCall") {
					stream.push({ type: "toolcall_start", contentIndex, partial: message });
					stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: message });
				}
			});
			stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
			stream.end(message);
		});
		return stream;
	};

	return {
		streamSimple,
		stream: (model, context, options) => streamSimple(model, context, options),
	};
}

function withUsage(model: Model<any>, base: Omit<AssistantMessage, "api" | "provider" | "model" | "usage" | "timestamp">): AssistantMessage {
	return {
		...base,
		api: "mock-api",
		provider: model.provider,
		model: model.id,
		timestamp: Date.now(),
		usage: {
			input: 120,
			output: 40,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 160,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	} as AssistantMessage;
}
