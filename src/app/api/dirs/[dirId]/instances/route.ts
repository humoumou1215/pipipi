import { ensureDirRuntime } from "@/server/runtime";
import { dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ dirId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) return json({ error: "dir not found" }, 404);
		return json(runtime.store.listInstances());
	});
}
