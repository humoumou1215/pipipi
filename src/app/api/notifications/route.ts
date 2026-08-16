import { getServerState } from "@/server/runtime";
import { handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser();
		const state = getServerState();
		const url = new URL(request.url);
		const unreadOnly = url.searchParams.get("unread") === "1";
		const notifications = state.globalDb.listNotifications(user.id, unreadOnly);
		return json({
			notifications,
			unread: state.globalDb.unreadCount(user.id),
		});
	});
}

export async function POST(request: Request) {
	return handle(async () => {
		const user = await requireUser();
		const state = getServerState();
		const url = new URL(request.url);
		if (url.pathname.endsWith("/read-all")) {
			state.globalDb.markAllNotificationsRead(user.id);
			return json({ ok: true });
		}
		const body = (await request.json()) as { id?: number };
		if (!body.id) return json({ error: "id required" }, 400);
		state.globalDb.markNotificationRead(body.id, user.id);
		return json({ ok: true });
	});
}
