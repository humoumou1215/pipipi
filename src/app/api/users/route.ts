import { hashPassword } from "@/server/auth";
import { getServerState } from "@/server/runtime";
import { handle, json, requireAdmin, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

/** 用户列表:登录用户可见基础信息(验收人选择用);仅管理员可见 isAdmin */
export async function GET() {
	return handle(async () => {
		const me = await requireUser();
		const state = getServerState();
		const users = state.globalDb.listUsers().map((u) => ({
			id: u.id,
			username: u.username,
			displayName: u.displayName,
			...(me.isAdmin ? { isAdmin: u.isAdmin === 1 } : {}),
		}));
		return json(users);
	});
}

export async function POST(request: Request) {
	return handle(async () => {
		await requireAdmin();
		const state = getServerState();
		const body = (await request.json()) as {
			username?: string;
			displayName?: string;
			password?: string;
			isAdmin?: boolean;
		};
		const username = body.username?.trim();
		if (!username || !body.password) return json({ error: "username and password required" }, 400);
		if (state.globalDb.getUserByUsername(username)) return json({ error: "username already exists" }, 409);
		const user = state.globalDb.createUser({
			username,
			displayName: body.displayName?.trim() || username,
			passwordHash: hashPassword(body.password),
			isAdmin: body.isAdmin === true,
		});
		return json(
			{ id: user.id, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin === 1 },
			201,
		);
	});
}
