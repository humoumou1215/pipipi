import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

/** 唤醒指定实例(带消息) */
export async function POST(request: Request, { params }: { params: Promise<{ dirId: string; instanceId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId, instanceId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const worker = runtime.agentHost.getWorker(instanceId);
		if (!worker) throw new ApiError(404, "instance not found");
		const body = (await request.json()) as { cardId?: number; message?: string };
		if (!body.cardId) throw new ApiError(400, "cardId required");
		if (!runtime.store.getCard(body.cardId)) throw new ApiError(404, "card not found");
		const signal = runtime.store.enqueueWakeSignal({
			targetRoleId: worker.role.id,
			targetInstanceId: instanceId,
			cardId: body.cardId,
			source: "manual",
			priority: 1,
		});
		if (signal) runtime.bus.emit({ type: "wake.created", signal });
		worker.enqueue({ source: "manual", cardId: body.cardId, message: body.message?.trim() || undefined, signalId: signal?.id });
		return json({ ok: true });
	});
}
