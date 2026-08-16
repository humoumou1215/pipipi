import { NextResponse } from "next/server";
import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 实例级 SSE:本实例的流式消息(message_update)与状态变化 */
export async function GET(_request: Request, { params }: { params: Promise<{ dirId: string; instanceId: string }> }) {
	const user = await requireUser();
	const { dirId, instanceId } = await params;
	const runtime = await ensureDirRuntime(dirParam({ dirId }));
	if (!runtime) throw new ApiError(404, "dir not found");
	const hub = runtime.agentHost.getInstanceHub(instanceId);
	if (!hub) throw new ApiError(404, "instance not found");
	return new NextResponse(hub.stream(), {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
		},
	});
}
