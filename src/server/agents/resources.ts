import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { loadSkills, type Skill } from "@earendil-works/pi-agent-core";
import type { BoardDb, RoleRow } from "../db/board-db";

export interface RoleFileConfig {
	id: string;
	name: string;
	kind?: "agent" | "human";
	model?: string;
	thinkingLevel?: string;
	instanceCount?: number;
	claimPolicy?: Record<string, unknown>;
	mentionPolicy?: Record<string, unknown>;
}

export interface RoleResources {
	roleDir: string;
	config: RoleFileConfig;
	agentMd: string;
	memoryMd: string;
	appendMd: string;
	skills: Skill[];
}

/** 项目角色目录优先,回退全局模板 */
export function resolveRoleDir(globalRolesDir: string, projectRolesDir: string, roleId: string): string | null {
	const project = join(projectRolesDir, roleId);
	if (existsSync(project) && statSync(project).isDirectory()) return project;
	const global = join(globalRolesDir, roleId);
	if (existsSync(global) && statSync(global).isDirectory()) return global;
	return null;
}

export function loadRoleConfig(roleDir: string): RoleFileConfig | null {
	const file = join(roleDir, "role.json");
	if (!existsSync(file)) return null;
	try {
		return JSON.parse(readFileSync(file, "utf-8")) as RoleFileConfig;
	} catch (error) {
		console.error(`[pipipi] invalid role.json at ${file}:`, error);
		return null;
	}
}

function readOptional(path: string): string {
	if (!existsSync(path)) return "";
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return "";
	}
}

export async function loadRoleResources(
	roleDir: string,
	workCwd: string,
): Promise<RoleResources> {
	const config = loadRoleConfig(roleDir);
	if (!config) throw new Error(`role.json missing in ${roleDir}`);
	const env = new NodeExecutionEnv({ cwd: workCwd });
	const skillsDir = join(roleDir, "skills");
	const loaded = existsSync(skillsDir) ? await loadSkills(env, skillsDir) : { skills: [] as Skill[] };
	await env.cleanup();
	return {
		roleDir,
		config,
		agentMd: readOptional(join(roleDir, "agent.md")),
		memoryMd: readOptional(join(roleDir, "memory.md")),
		appendMd: readOptional(join(roleDir, "append_system.md")),
		skills: loaded.skills,
	};
}

/** 扫描全局 + 项目角色目录,注册到 roles 表 */
export async function discoverAndRegisterRoles(
	store: BoardDb,
	globalRolesDir: string,
	projectRolesDir: string,
	workCwd: string,
): Promise<string[]> {
	const roleIds = new Set<string>();
	for (const base of [globalRolesDir, projectRolesDir]) {
		if (!existsSync(base)) continue;
		for (const entry of readdirSync(base)) {
			const dir = join(base, entry);
			if (!statSync(dir).isDirectory()) continue;
			const config = loadRoleConfig(dir);
			if (!config || !config.id) continue;
			roleIds.add(config.id);
		}
	}
	const registered: string[] = [];
	for (const roleId of roleIds) {
		const roleDir = resolveRoleDir(globalRolesDir, projectRolesDir, roleId);
		if (!roleDir) continue;
		const resources = await loadRoleResources(roleDir, workCwd);
		store.upsertRole({
			id: resources.config.id,
			name: resources.config.name ?? resources.config.id,
			kind: resources.config.kind ?? "agent",
			model: resources.config.model ?? null,
			thinkingLevel: resources.config.thinkingLevel ?? "off",
			instanceCount: resources.config.instanceCount ?? 1,
			claimPolicy: resources.config.claimPolicy ?? {},
			mentionPolicy: resources.config.mentionPolicy ?? {},
			roleDir,
		});
		registered.push(roleId);
	}
	return registered;
}

/** 角色目录的配置文件内容(供 API 读取) */
export function readRoleFiles(roleDir: string): Record<string, string> {
	return {
		"role.json": readOptional(join(roleDir, "role.json")),
		"agent.md": readOptional(join(roleDir, "agent.md")),
		"memory.md": readOptional(join(roleDir, "memory.md")),
		"append_system.md": readOptional(join(roleDir, "append_system.md")),
	};
}

export function roleDisplayName(role: RoleRow): string {
	return role.name || role.id;
}
