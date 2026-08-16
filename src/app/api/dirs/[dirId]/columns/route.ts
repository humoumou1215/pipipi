import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, handle, json, requireAdmin } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ dirId: string }> }) {
	return handle(async () => {
		await requireAdmin();
		const { dirId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const body = (await request.json()) as {
			name?: string;
			position?: number;
			claimable?: boolean;
			done?: boolean;
			workflowRole?: string;
		};
		if (!body.name) throw new ApiError(400, "name required");
		const maxPosition = runtime.store.listColumns().reduce((max, col) => Math.max(max, col.position), -1);
		const column = runtime.store.createColumn({
			name: body.name,
			position: body.position ?? maxPosition + 1,
			claimable: body.claimable === true,
			done: body.done === true,
			workflowRole: body.workflowRole,
		});
		return json(column, 201);
	});
}
