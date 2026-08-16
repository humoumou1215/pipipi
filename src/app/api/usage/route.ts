import { getServerState } from "@/server/runtime";
import { handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

/** 用量统计:GET /api/usage?dir=<dirId>&role=<roleId>&since=<ISO> */
export async function GET(request: Request) {
	return handle(async () => {
		await requireUser();
		const state = getServerState();
		const url = new URL(request.url);
		const dirId = url.searchParams.get("dir");
		const roleId = url.searchParams.get("role") ?? undefined;
		const since = url.searchParams.get("since") ?? undefined;

		const runtimes = dirId
			? [state.runtimes.get(dirId)].filter((r): r is NonNullable<typeof r> => r !== undefined)
			: [...state.runtimes.values()];

		const results = runtimes.map((runtime) => ({
			dirId: runtime.dirId,
			dir: runtime.dir,
			name: runtime.boardName,
			summary: runtime.store.usageSummary({ roleId, since }),
		}));

		return json({ dirs: results });
	});
}
