import { getDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

/** 添加清单项 */
export async function POST(request: Request, { params }: { params: Promise<{ dirId: string; cardId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId, cardId } = await params;
		const runtime = await getDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const id = Number(cardId);
		if (!runtime.store.getCard(id)) throw new ApiError(404, "card not found");
		const body = (await request.json()) as { text?: string };
		if (!body.text?.trim()) throw new ApiError(400, "text required");
		const item = runtime.store.addChecklistItem(id, body.text.trim());
		const card = runtime.store.getCard(id)!;
		runtime.bus.emit({ type: "card.updated", card });
		return json(item, 201);
	});
}

/** 切换清单项完成状态 */
export async function PUT(request: Request, { params }: { params: Promise<{ dirId: string; cardId: string; itemId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId, cardId, itemId } = await params;
		const runtime = await getDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const body = (await request.json()) as { done?: boolean };
		if (typeof body.done !== "boolean") throw new ApiError(400, "done required");
		runtime.store.updateChecklistItem(Number(itemId), body.done);
		const card = runtime.store.getCard(Number(cardId));
		runtime.bus.emit({ type: "card.updated", card });
		return json({ ok: true });
	});
}
