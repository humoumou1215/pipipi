import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ dirId: string }> }) {
	return handle(async () => {
		const user = await requireUser();
		const { dirId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const body = (await request.json()) as {
			title?: string;
			description?: string;
			type?: string;
			priority?: number;
			tags?: string[];
			columnId?: number;
			assigneeRole?: string | null;
			reviewApprover?: number | null;
			stages?: Array<{ roleId: string; title?: string; description?: string }>;
		};
		if (!body.title?.trim()) throw new ApiError(400, "title required");
		const columnId = body.columnId ?? runtime.store.listColumns()[0]?.id;
		if (!columnId) throw new ApiError(400, "no columns; create a column first");
		const approver = body.reviewApprover ?? user.id;
		const card = runtime.store.createCard({
			title: body.title.trim(),
			description: body.description ?? "",
			type: body.type ?? "task",
			priority: body.priority ?? 0,
			tags: body.tags ?? [],
			columnId,
			assigneeRole: body.assigneeRole ?? null,
			reviewApprover: approver,
			stages: body.stages ?? [],
			createdBy: user.id,
		});
		runtime.bus.emit({ type: "card.created", card });
		runtime.store.addActivity(card.id, "user", `u${user.id}`, "created", { title: card.title });
		if (body.assigneeRole) {
			runtime.orchestrator.wakeRole(body.assigneeRole, card.id, "assign");
		}
		return json(card, 201);
	});
}
