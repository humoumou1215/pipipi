import { getDirRuntime } from "@/server/runtime";
import { dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

/** 切换清单项完成状态(兼容 :itemId 路径) */
export async function PUT(request: Request, { params }: { params: Promise<{ dirId: string; cardId: string; itemId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId, cardId, itemId } = await params;
		const runtime = await getDirRuntime(dirParam({ dirId }));
		if (!runtime) return json({ error: "dir not found" }, 404);
		const body = (await request.json()) as { done?: boolean };
		runtime.store.updateChecklistItem(Number(itemId), body.done === true);
		const card = runtime.store.getCard(Number(cardId));
		runtime.bus.emit({ type: "card.updated", card });
		return json({ ok: true });
	});
}
