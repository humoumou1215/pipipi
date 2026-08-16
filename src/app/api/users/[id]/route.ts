import { getServerState } from "@/server/runtime";
import { ApiError, handle, json, requireAdmin } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	return handle(async () => {
		const admin = await requireAdmin();
		const { id } = await params;
		const userId = Number(id);
		if (!Number.isInteger(userId)) throw new ApiError(400, "invalid user id");
		if (userId === admin.id) throw new ApiError(400, "cannot delete yourself");
		const state = getServerState();
		if (!state.globalDb.getUserById(userId)) throw new ApiError(404, "user not found");
		state.globalDb.deleteUser(userId);
		return json({ ok: true });
	});
}
