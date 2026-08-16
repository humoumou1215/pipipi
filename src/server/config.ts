import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

export interface PipipiConfig {
	/** 全局数据目录(users.db、全局角色模板、secret) */
	dataDir: string;
	/** session cookie 签名密钥 */
	secret: string;
	/** 自由认领扫描间隔(ms) */
	scanIntervalMs: number;
	/** 认领心跳 TTL(ms),超时回收 */
	claimTtlMs: number;
	/** 启动时注册的看板目录 */
	initialDirs: string[];
	adminUser?: string;
	adminPassword?: string;
	/** 整体 Basic Auth 密码(pi-web 模式) */
	basicAuthPassword?: string;
}

function loadSecret(dataDir: string): string {
	const fromEnv = process.env.PIPIPI_SECRET;
	if (fromEnv) return fromEnv;
	const file = join(dataDir, "secret");
	if (existsSync(file)) {
		return readFileSync(file, "utf-8").trim();
	}
	mkdirSync(dataDir, { recursive: true });
	const generated = randomBytes(32).toString("hex");
	writeFileSync(file, generated, { mode: 0o600 });
	return generated;
}

export function getConfig(): PipipiConfig {
	const dataDir = process.env.PIPIPI_DATA_DIR ?? join(homedir(), ".pipipi");
	const scanIntervalMs = Number(process.env.PIPIPI_SCAN_INTERVAL_MS ?? 30000);
	const claimTtlMs = Number(process.env.PIPIPI_CLAIM_TTL_MS ?? 5 * 60_000);
	const initialDirs = (process.env.PIPIPI_DIRS ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return {
		dataDir,
		secret: loadSecret(dataDir),
		scanIntervalMs,
		claimTtlMs,
		initialDirs,
		adminUser: process.env.PIPIPI_ADMIN_USER || undefined,
		adminPassword: process.env.PIPIPI_ADMIN_PASSWORD || undefined,
		basicAuthPassword: process.env.PIPIPI_PASSWORD || undefined,
	};
}

/** 全局角色模板目录 ~/.pipipi/roles/ */
export function globalRolesDir(dataDir: string): string {
	return join(dataDir, "roles");
}

/** 项目数据目录 <dir>/.kanban */
export function projectKanbanDir(dir: string): string {
	return join(dir, ".kanban");
}

/** 项目角色目录 <dir>/.kanban/roles */
export function projectRolesDir(dir: string): string {
	return join(projectKanbanDir(dir), "roles");
}

/** 每卡片会话目录 <dir>/.kanban/sessions */
export function projectSessionsDir(dir: string): string {
	return join(projectKanbanDir(dir), "sessions");
}

/** 规范化目录 id(路径 hash) */
export function dirIdOf(path: string): string {
	return createHash("sha256").update(path).digest("hex").slice(0, 24);
}
