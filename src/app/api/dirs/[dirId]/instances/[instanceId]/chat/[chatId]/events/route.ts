import { NextResponse } from "next/server";
import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 直聊事件流:harness 消息增量 */
export async function GET(_request: Request, { params }: { params: Promise<{ dirId: string; instanceId: string; chatId: string }> }) {
	const user = await requireUser();
	const { dirId, instanceId, chatId } = await params;
	const runtime = await ensureDirRuntime(dirParam({ dirId }));
	if (!runtime) throw new ApiError(404, "dir not found");
	const chat = runtime.agentHost.getChat(instanceId);
	if (!chat || chat.chatId !== chatId) throw new ApiError(404, "chat not found");
	return new NextResponse(chat.hub.stream(), {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
		},
	});
}
