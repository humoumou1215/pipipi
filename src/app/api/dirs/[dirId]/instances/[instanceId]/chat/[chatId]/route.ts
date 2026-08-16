import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

/** 发送直聊消息 */
export async function POST(request: Request, { params }: { params: Promise<{ dirId: string; instanceId: string; chatId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId, instanceId, chatId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const chat = runtime.agentHost.getChat(instanceId);
		if (!chat || chat.chatId !== chatId) throw new ApiError(404, "chat not found");
		const body = (await request.json()) as { text?: string };
		if (!body.text?.trim()) throw new ApiError(400, "text required");
		await chat.message(body.text.trim());
		return json({ ok: true });
	});
}

/** 结束直聊 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ dirId: string; instanceId: string; chatId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId, instanceId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		await runtime.agentHost.endChat(instanceId);
		return json({ ok: true });
	});
}
