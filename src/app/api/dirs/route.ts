import { existsSync } from "node:fs";
import { getServerState, initDirRuntime } from "@/server/runtime";
import { ApiError, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
	return handle(async () => {
		await requireUser();
		const state = getServerState();
		const dirs = state.globalDb
			.listDirs()
			.filter((d) => existsSync(d.path)) // 目录已被删除的注册记录不再展示
			.map((d) => {
				const runtime = state.runtimes.get(d.id);
				return {
					id: d.id,
					path: d.path,
					name: d.name,
					summary: runtime
						? {
								boards: runtime.store.listCards().length,
								instances: runtime.store.listInstances().length,
								active: runtime.store.listInstances().filter((i) => i.status === "working").length,
							}
						: null,
				};
			});
		return json(dirs);
	});
}

export async function POST(request: Request) {
	return handle(async () => {
		await requireUser();
		const body = (await request.json()) as { path?: string; name?: string };
		const path = body.path?.trim();
		if (!path) throw new ApiError(400, "path required");
		const runtime = await initDirRuntime(path);
		return json({ id: runtime.dirId, path: runtime.dir, name: runtime.boardName }, 201);
	});
}
