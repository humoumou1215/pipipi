import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ dirId: string; cardId: string }> }) {
	return handle(async () => {
		const user = await requireUser();
		const { dirId, cardId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const id = Number(cardId);
		const body = (await request.json()) as { columnId?: number };
		if (!body.columnId) throw new ApiError(400, "columnId required");
		if (!runtime.store.getColumn(body.columnId)) throw new ApiError(400, "column not found");
		const card = runtime.store.moveCard(id, body.columnId);
		runtime.bus.emit({ type: "card.updated", card });
		runtime.store.addActivity(id, "user", `u${user.id}`, "moved", { columnId: body.columnId });
		return json(card);
	});
}
