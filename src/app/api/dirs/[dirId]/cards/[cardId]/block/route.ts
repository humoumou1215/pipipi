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
		const body = (await request.json()) as { action?: "block" | "unblock"; reason?: string };
		if (body.action === "block") {
			runtime.store.markBlocked(id, body.reason ?? "");
			const card = runtime.store.getCard(id);
			runtime.bus.emit({ type: "card.updated", card });
			runtime.store.addActivity(id, "user", `u${user.id}`, "blocked", { reason: body.reason ?? "" });
		} else if (body.action === "unblock") {
			runtime.store.unblock(id);
			const card = runtime.store.getCard(id);
			runtime.bus.emit({ type: "card.updated", card });
			runtime.store.addActivity(id, "user", `u${user.id}`, "unblocked", {});
		} else {
			throw new ApiError(400, "action must be block or unblock");
		}
		return json(runtime.store.getCard(id));
	});
}
