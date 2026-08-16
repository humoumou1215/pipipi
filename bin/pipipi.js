#!/usr/bin/env node

// pipipi CLI:看板 Agent 协作平台
// 用法: pipipi [-H host] [-p port] [--dir path ...] [--mock]
// 参照 pi-web:解析参数后以本地 next 启动生产服务器。

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function parseArgs(args) {
	let host = process.env.PIPIPI_HOST ?? "127.0.0.1";
	let port = process.env.PIPIPI_PORT ?? "3000";
	const dirs = [];
	let mock = false;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "-H" || a === "--host") host = args[++i] ?? host;
		else if (a === "-p" || a === "--port") port = args[++i] ?? port;
		else if (a === "--dir") dirs.push(args[++i]);
		else if (a === "--mock") mock = true;
		else if (a === "--help" || a === "-h") {
			console.log("pipipi — kanban agent collaboration platform");
			console.log("");
			console.log("Usage: pipipi [-H host] [-p port] [--dir path ...] [--mock]");
			console.log("");
			console.log("Options:");
			console.log("  -H, --host <host>     listen host (default PIPIPI_HOST or 127.0.0.1)");
			console.log("  -p, --port <port>     listen port (default PIPIPI_PORT or 3000)");
			console.log("  --dir <path>          register a board directory (repeatable; or PIPIPI_DIRS)");
			console.log("  --mock                use the built-in mock provider (no API key needed)");
			console.log("");
			console.log("Environment:");
			console.log("  PIPIPI_DATA_DIR       global data dir (default ~/.pipipi)");
			console.log("  PIPIPI_ADMIN_USER / PIPIPI_ADMIN_PASSWORD   first admin bootstrap");
			console.log("  PIPIPI_PASSWORD       optional global Basic Auth password");
			console.log("  OPENCODE_API_KEY      model API key (opencode-go provider)");
			process.exit(0);
		}
	}
	return { host, port, dirs, mock };
}

const { host, port, dirs, mock } = parseArgs(process.argv.slice(2));

// 优先从包自身/顶层 node_modules 解析 next(依赖可能被 npm 提升)
let nextBin;
try {
	nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
	nextBin = join(pkgDir, "node_modules", "next", "dist", "bin", "next");
}
if (!existsSync(nextBin)) {
	console.error("pipipi: next not found. Run `npm install` in the package directory first.");
	process.exit(1);
}

const env = { ...process.env, PIPIPI_HOST: host };
if (dirs.length > 0) env.PIPIPI_DIRS = dirs.join(",");
if (mock) env.PIPIPI_MOCK_PROVIDER = "1";

const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
if (!loopback.has(host) && !process.env.PIPIPI_PASSWORD) {
	console.warn(
		`Warning: pipipi is listening on ${host} without authentication. Use PIPIPI_PASSWORD or a trusted network.`,
	);
}

console.log(`pipipi starting on http://${host}:${port}${dirs.length ? ` (dirs: ${dirs.join(", ")})` : ""}`);
const child = spawn(process.execPath, [nextBin, "start", "-H", host, "-p", port], {
	cwd: pkgDir,
	stdio: "inherit",
	env,
});
child.on("exit", (code) => process.exit(code ?? 0));
