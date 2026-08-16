import { handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
	return handle(async () => {
		const user = await requireUser();
		return json({ id: user.id, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin === 1 });
	});
}
