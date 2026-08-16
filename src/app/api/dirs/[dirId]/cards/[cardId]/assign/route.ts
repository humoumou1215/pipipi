import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ dirId: string; cardId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId, cardId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const id = Number(cardId);
		const body = (await request.json()) as { roleId?: string };
		if (!body.roleId) throw new ApiError(400, "roleId required");
		if (!runtime.store.getRole(body.roleId)) throw new ApiError(404, "role not found");
		if (!runtime.store.getCard(id)) throw new ApiError(404, "card not found");
		runtime.store.setAssignee(id, body.roleId);
		const card = runtime.store.getCard(id)!;
		runtime.bus.emit({ type: "card.updated", card });
		runtime.store.addActivity(id, "user", "user", "assigned", { roleId: body.roleId });
		runtime.orchestrator.wakeRole(body.roleId, id, "assign");
		return json(card);
	});
}
