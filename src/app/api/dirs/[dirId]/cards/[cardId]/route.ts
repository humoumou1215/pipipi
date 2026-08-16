import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ dirId: string; cardId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId, cardId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const id = Number(cardId);
		const card = runtime.store.getCard(id);
		if (!card) throw new ApiError(404, "card not found");
		const activities = runtime.store.listActivities(id);
		return json({ card, activities });
	});
}

export async function PUT(request: Request, { params }: { params: Promise<{ dirId: string; cardId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId, cardId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const id = Number(cardId);
		const body = (await request.json()) as {
			title?: string;
			description?: string;
			type?: string;
			priority?: number;
			tags?: string[];
			dueAt?: string | null;
			reviewApprover?: number | null;
			version?: number;
		};
		const card = runtime.store.updateCard(
			id,
			{
				title: body.title,
				description: body.description,
				type: body.type,
				priority: body.priority,
				tags: body.tags,
				dueAt: body.dueAt,
				reviewApprover: body.reviewApprover,
			},
			body.version,
		);
		runtime.bus.emit({ type: "card.updated", card });
		return json(card);
	});
}
