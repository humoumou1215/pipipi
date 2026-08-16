import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { handle, json, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

/** 目录浏览(对齐 pi-web /api/cwd/browse):GET /api/fs/browse?path=<abs> */
export async function GET(request: Request) {
	return handle(async () => {
		await requireUser();
		const url = new URL(request.url);
		const raw = url.searchParams.get("path") ?? "/";
		let path: string;
		try {
			path = resolve(raw || "/");
		} catch {
			return json({ error: "invalid path" }, 400);
		}
		let stat;
		try {
			stat = statSync(path);
		} catch {
			return json({ error: "path not found" }, 404);
		}
		if (!stat.isDirectory()) {
			return json({ error: "not a directory" }, 400);
		}
		const directories: Array<{ name: string; path: string }> = [];
		let entries;
		try {
			entries = readdirSync(path, { withFileTypes: true });
		} catch {
			return json({ error: "permission denied" }, 403);
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith(".")) continue; // 隐藏目录不展示
			let isDir = true;
			try {
				isDir = statSync(join(path, entry.name)).isDirectory();
			} catch {
				isDir = false;
			}
			if (isDir) directories.push({ name: entry.name, path: join(path, entry.name) });
		}
		directories.sort((a, b) => a.name.localeCompare(b.name));
		const parentPath = dirname(path) === path ? null : dirname(path);
		return json({ path, parentPath, directories });
	});
}
