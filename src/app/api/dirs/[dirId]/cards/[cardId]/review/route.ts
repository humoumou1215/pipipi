import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

/** 验收:approve → done;reject → 回 ready + 活动(rejected)由 orchestrator @原处理角色 */
export async function POST(request: Request, { params }: { params: Promise<{ dirId: string; cardId: string }> }) {
	return handle(async () => {
		const user = await requireUser();
		const { dirId, cardId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const id = Number(cardId);
		const card = runtime.store.getCard(id);
		if (!card) throw new ApiError(404, "card not found");
		if (card.reviewApprover != null && card.reviewApprover !== user.id && user.isAdmin !== 1) {
			throw new ApiError(403, "only the review approver or an admin can review");
		}
		const body = (await request.json()) as { action?: "approve" | "reject"; comment?: string };
		if (body.action === "approve") {
			runtime.store.approveCard(id);
			const updated = runtime.store.getCard(id)!;
			runtime.bus.emit({ type: "card.updated", card: updated });
			runtime.store.addActivity(id, "user", `u${user.id}`, "review_approved", {
				comment: body.comment ?? "",
			});
		} else if (body.action === "reject") {
			runtime.store.rejectCard(id);
			const updated = runtime.store.getCard(id)!;
			runtime.bus.emit({ type: "card.updated", card: updated });
			// 记录原处理角色,orchestrator 收到 rejected 活动后 @唤醒
			const previousHolder = card.holderId;
			const previousRole = previousHolder ? previousHolder.split("-").slice(0, -1).join("-") : null;
			runtime.store.addActivity(id, "user", `u${user.id}`, "rejected", {
				roleId: previousRole,
				comment: body.comment ?? "",
			});
		} else {
			throw new ApiError(400, "action must be approve or reject");
		}
		return json(runtime.store.getCard(id));
	});
}
