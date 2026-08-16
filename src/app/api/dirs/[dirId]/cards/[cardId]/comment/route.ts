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
		const body = (await request.json()) as { text?: string };
		const text = body.text?.trim();
		if (!text) throw new ApiError(400, "text required");
		if (!runtime.store.getCard(id)) throw new ApiError(404, "card not found");
		const activity = runtime.store.addActivity(id, "user", `u${user.id}`, "comment", { text });
		runtime.bus.emit({ type: "activity.created", activity });
		// 提及由 orchestrator 订阅 activity.created 统一处理
		return json(activity, 201);
	});
}
