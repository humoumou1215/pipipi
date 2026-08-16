import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { ensureDirRuntime } from "@/server/runtime";
import { ApiError, dirParam, handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

const MAX_PREVIEW = 64 * 1024;

/** 解析看板目录内的相对路径,防越界 */
function resolveInside(dir: string, rel: string | null): string {
	const target = resolve(dir, rel ?? ".");
	if (target !== dir && !target.startsWith(dir + sep)) {
		throw new ApiError(400, "path outside board directory");
	}
	return target;
}

/** 目录列表:GET /api/dirs/:dirId/files?path=<rel> */
export async function GET(request: Request, { params }: { params: Promise<{ dirId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const url = new URL(request.url);
		const rel = url.searchParams.get("path") ?? "";
		const target = resolveInside(runtime.dir, rel || null);
		const stat = statSync(target, { throwIfNoEntry: false });
		if (!stat) throw new ApiError(404, "path not found");
		if (stat.isFile()) {
			const content = readFileSync(target, "utf-8");
			return json({
				kind: "file",
				path: rel,
				name: target.split(sep).pop(),
				size: stat.size,
				mtime: stat.mtime.toISOString(),
				content: content.slice(0, MAX_PREVIEW),
				truncated: content.length > MAX_PREVIEW,
			});
		}
		const entries = readdirSync(target, { withFileTypes: true }).map((entry) => {
			const full = join(target, entry.name);
			let size = 0;
			let mtime = "";
			try {
				const s = statSync(full);
				size = s.size;
				mtime = s.mtime.toISOString();
			} catch {
				// ignore
			}
			return {
				name: entry.name,
				kind: entry.isDirectory() ? "dir" : "file",
				size,
				mtime,
			};
		});
		entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
		return json({ kind: "dir", path: rel, entries });
	});
}
