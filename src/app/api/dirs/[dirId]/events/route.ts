import { NextResponse } from "next/server";
import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ dirId: string }> }) {
	const user = await requireUser();
	const { dirId } = await params;
	const runtime = await ensureDirRuntime(dirParam({ dirId }));
	if (!runtime) throw new ApiError(404, "dir not found");
	return new NextResponse(runtime.hub.stream(), {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
		},
	});
}
