import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, handle, json, requireUser } from "@/server/api-helpers";
import type { ChatSource } from "@/server/agents/chat";

export const dynamic = "force-dynamic";

/** 开始直聊:POST /api/dirs/:dirId/instances/:instanceId/chat {source:{kind:"card",cardId}|{kind:"blank"}} */
export async function POST(request: Request, { params }: { params: Promise<{ dirId: string; instanceId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId, instanceId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const body = (await request.json().catch(() => ({}))) as { source?: ChatSource };
		const source: ChatSource = body.source ?? { kind: "blank" };
		try {
			const chat = await runtime.agentHost.startChat(instanceId, source);
			return json({ chatId: chat.chatId, instanceId }, 201);
		} catch (error) {
			if (error instanceof Error && (error.message.includes("not found") || error.message.includes("working"))) {
				throw new ApiError(409, error.message);
			}
			throw error;
		}
	});
}

export async function GET(_request: Request, { params }: { params: Promise<{ dirId: string; instanceId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId, instanceId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const chat = runtime.agentHost.getChat(instanceId);
		return json({ active: chat !== undefined, chatId: chat?.chatId ?? null });
	});
}
