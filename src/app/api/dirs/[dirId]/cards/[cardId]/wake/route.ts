import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

/** 人工唤醒:对卡片的负责人角色或指定角色/实例发送带消息的唤醒 */
export async function POST(request: Request, { params }: { params: Promise<{ dirId: string; cardId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId, cardId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const id = Number(cardId);
		const card = runtime.store.getCard(id);
		if (!card) throw new ApiError(404, "card not found");
		const body = (await request.json()) as { roleId?: string; instanceId?: string; message?: string };
		const message = body.message?.trim() || undefined;

		if (body.instanceId) {
			const worker = runtime.agentHost.getWorker(body.instanceId);
			if (!worker) throw new ApiError(404, "instance not found");
			runtime.store.addActivity(id, "user", "user", "manual_wake", { instanceId: body.instanceId, message });
			worker.enqueue({ source: "manual", cardId: id, message });
			return json({ ok: true });
		}
		const roleId = body.roleId ?? card.assigneeRole;
		if (!roleId) throw new ApiError(400, "no assignee role; specify roleId");
		if (!runtime.store.getRole(roleId)) throw new ApiError(404, "role not found");
		runtime.store.addActivity(id, "user", "user", "manual_wake", { roleId, message });
		const signal = runtime.store.enqueueWakeSignal({
			targetRoleId: roleId,
			cardId: id,
			source: "manual",
			priority: 1,
		});
		if (signal) runtime.bus.emit({ type: "wake.created", signal });
		runtime.agentHost.wakeRole(roleId, { cardId: id, source: "manual", message });
		return json({ ok: true });
	});
}
