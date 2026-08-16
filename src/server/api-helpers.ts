import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionCookieName, userFromToken } from "./auth";
import { getServerState } from "./runtime";
import type { UserRow } from "./db/global-db";

export class ApiError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** 返回 NextResponse;统一错误处理 */
export async function handle(fn: () => Promise<NextResponse> | NextResponse): Promise<NextResponse> {
	try {
		return await fn();
	} catch (error) {
		if (error instanceof ApiError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		console.error("[pipipi] route error:", error);
		return NextResponse.json({ error: "internal error" }, { status: 500 });
	}
}

export async function currentUser(): Promise<UserRow | null> {
	const state = getServerState();
	const store = await cookies();
	const token = store.get(sessionCookieName())?.value;
	return userFromToken(token, state.globalDb, state.config.secret);
}

export async function requireUser(): Promise<UserRow> {
	const user = await currentUser();
	if (!user) throw new ApiError(401, "unauthorized");
	return user;
}

export async function requireAdmin(): Promise<UserRow> {
	const user = await requireUser();
	if (!user.isAdmin) throw new ApiError(403, "forbidden");
	return user;
}

export function json(data: unknown, status = 200): NextResponse {
	return NextResponse.json(data, { status });
}

export function dirParam(params: Record<string, string | string[] | undefined>): string {
	const value = params.dirId;
	if (typeof value !== "string" || value.length === 0) throw new ApiError(400, "missing dirId");
	return value;
}
