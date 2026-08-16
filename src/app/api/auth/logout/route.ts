import { NextResponse } from "next/server";
import { sessionCookieName } from "@/server/auth";
import { handle } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function POST() {
	return handle(() => {
		const response = NextResponse.json({ ok: true });
		response.headers.set("set-cookie", `${sessionCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
		return response;
	});
}
