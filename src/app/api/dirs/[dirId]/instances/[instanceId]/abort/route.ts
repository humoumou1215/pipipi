import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

/** 中止实例当前 run */
export async function POST(_request: Request, { params }: { params: Promise<{ dirId: string; instanceId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId, instanceId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const worker = runtime.agentHost.getWorker(instanceId);
		if (!worker) throw new ApiError(404, "instance not found");
		await worker.abort();
		return json({ ok: true });
	});
}
