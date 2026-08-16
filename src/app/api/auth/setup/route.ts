import { NextResponse } from "next/server";
import { hashPassword } from "@/server/auth";
import { getServerState } from "@/server/runtime";
import { handle, json } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

/** 首个管理员创建:仅当 users 表为空 */
export async function POST(request: Request) {
	return handle(() => {
		const state = getServerState();
		if (state.globalDb.countUsers() > 0) {
			return json({ error: "already initialized" }, 409);
		}
		return request.json().then((body: { username?: string; password?: string; displayName?: string }) => {
			const username = body.username?.trim();
			const password = body.password;
			if (!username || !password) return json({ error: "username and password required" }, 400);
			const user = state.globalDb.createUser({
				username,
				displayName: body.displayName?.trim() || username,
				passwordHash: hashPassword(password),
				isAdmin: true,
			});
			return json({ id: user.id, username: user.username, displayName: user.displayName, isAdmin: true });
		});
	});
}

export async function GET() {
	return handle(() => {
		const state = getServerState();
		return json({ initialized: state.globalDb.countUsers() > 0 });
	});
}

export async function OPTIONS() {
	return new NextResponse(null, { status: 204 });
}
