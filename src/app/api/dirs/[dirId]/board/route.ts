import { ensureDirRuntime } from "@/server/runtime";
import { dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ dirId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) return json({ error: "dir not found" }, 404);
		const store = runtime.store;
		const columns = store.listColumns().map((col) => ({
			id: col.id,
			name: col.name,
			position: col.position,
			claimable: col.claimable === 1,
			done: col.done === 1,
			workflowRole: col.workflowRole,
		}));
		const cards = store.listCards().map((c) => ({
			id: c.id,
			title: c.title,
			type: c.type,
			priority: c.priority,
			tags: c.tags,
			columnId: c.columnId,
			status: c.status,
			holderId: c.holderId,
			assigneeRole: c.assigneeRole,
			reviewApprover: c.reviewApprover,
			dueAt: c.dueAt,
			updatedAt: c.updatedAt,
		}));
		const roles = store.listRoles().map((r) => ({
			id: r.id,
			name: r.name,
			kind: r.kind,
			model: r.model,
			instanceCount: r.instanceCount,
		}));
		const instances = store.listInstances().map((i) => ({
			id: i.id,
			roleId: i.roleId,
			status: i.status,
			currentCardId: i.currentCardId,
			queueLen: i.queueLen,
		}));
		return json({ dirId, name: runtime.boardName, path: runtime.dir, columns, cards, roles, instances });
	});
}
