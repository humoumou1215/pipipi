import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { GlobalDb, UserRow } from "./db/global-db";

const SESSION_COOKIE = "pipipi_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
	const salt = randomBytes(16).toString("hex");
	const hash = scryptSync(password, salt, 64).toString("hex");
	return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const [salt, hash] = stored.split(":");
	if (!salt || !hash) return false;
	const candidate = scryptSync(password, salt, 64);
	const expected = Buffer.from(hash, "hex");
	if (candidate.length !== expected.length) return false;
	return timingSafeEqual(candidate, expected);
}

export interface SessionPayload {
	uid: number;
	exp: number;
}

function sign(data: string, secret: string): string {
	return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSessionToken(userId: number, secret: string): string {
	const payload: SessionPayload = { uid: userId, exp: Date.now() + SESSION_TTL_MS };
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string): SessionPayload | null {
	if (!token) return null;
	const dot = token.indexOf(".");
	if (dot < 0) return null;
	const body = token.slice(0, dot);
	const signature = token.slice(dot + 1);
	const expected = sign(body, secret);
	const sigBuf = Buffer.from(signature);
	const expBuf = Buffer.from(expected);
	if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
	try {
		const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as SessionPayload;
		if (typeof payload.uid !== "number" || typeof payload.exp !== "number") return null;
		if (payload.exp < Date.now()) return null;
		return payload;
	} catch {
		return null;
	}
}

export function sessionCookieName(): string {
	return SESSION_COOKIE;
}

/** 从 session token 解析当前用户 */
export function userFromToken(token: string | undefined, globalDb: GlobalDb, secret: string): UserRow | null {
	if (!token) return null;
	const payload = verifySessionToken(token, secret);
	if (!payload) return null;
	return globalDb.getUserById(payload.uid) ?? null;
}
