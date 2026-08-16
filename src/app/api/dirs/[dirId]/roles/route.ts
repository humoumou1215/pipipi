import { ensureDirRuntime } from "@/server/runtime";
import { dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ dirId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) return json({ error: "dir not found" }, 404);
		const roles = runtime.store.listRoles().map((r) => ({
			id: r.id,
			name: r.name,
			kind: r.kind,
			model: r.model,
			thinkingLevel: r.thinkingLevel,
			instanceCount: r.instanceCount,
			claimPolicy: r.claimPolicy,
			roleDir: r.roleDir,
		}));
		return json(roles);
	});
}
