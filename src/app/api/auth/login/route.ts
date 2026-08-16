import { NextResponse } from "next/server";
import { createSessionToken, sessionCookieName, verifyPassword } from "@/server/auth";
import { getServerState } from "@/server/runtime";
import { ApiError, handle, json } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	return handle(async () => {
		const state = getServerState();
		const body = (await request.json()) as { username?: string; password?: string };
		const username = body.username?.trim();
		if (!username || !body.password) throw new ApiError(400, "username and password required");
		const user = state.globalDb.getUserByUsername(username);
		if (!user || !verifyPassword(body.password, user.passwordHash)) {
			throw new ApiError(401, "invalid credentials");
		}
		const token = createSessionToken(user.id, state.config.secret);
		const response = NextResponse.json({
			id: user.id,
			username: user.username,
			displayName: user.displayName,
			isAdmin: user.isAdmin === 1,
		});
		response.headers.set(
			"set-cookie",
			`${sessionCookieName()}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`,
		);
		return response;
	});
}
