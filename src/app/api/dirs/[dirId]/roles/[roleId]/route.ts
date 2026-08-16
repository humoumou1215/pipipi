import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDirRuntime } from "@/server/runtime";
import { globalRolesDir, projectRolesDir } from "@/server/config";
import { loadRoleConfig, loadRoleResources, readRoleFiles, resolveRoleDir } from "@/server/agents/resources";
import { ApiError, dirParam, handle, json, requireAdmin, requireUser } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ dirId: string; roleId: string }> }) {
	return handle(async () => {
		await requireUser();
		const { dirId, roleId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const role = runtime.store.getRole(roleId);
		if (!role) throw new ApiError(404, "role not found");
		const files = readRoleFiles(role.roleDir);
		return json({ role, files });
	});
}

/** 创建角色目录模板(全局或项目) */
export async function POST(request: Request, { params }: { params: Promise<{ dirId: string; roleId: string }> }) {	return handle(async () => {
		await requireAdmin();
		const { dirId, roleId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		if (runtime.store.getRole(roleId)) throw new ApiError(409, "role already exists");
		const body = (await request.json()) as {
			scope?: "global" | "project";
			name?: string;
			model?: string;
			instanceCount?: number;
			agentMd?: string;
			memoryMd?: string;
		};
		const scope = body.scope === "global" ? "global" : "project";
		const base = scope === "global" ? globalRolesDir(runtime.config.dataDir) : projectRolesDir(runtime.dir);
		const roleDir = join(base, roleId);
		mkdirSync(join(roleDir, "skills"), { recursive: true });
		const config = {
			id: roleId,
			name: body.name ?? roleId,
			kind: "agent",
			model: body.model,
			thinkingLevel: "off",
			instanceCount: body.instanceCount ?? 1,
			claimPolicy: {},
			mentionPolicy: {},
		};
		writeFileSync(join(roleDir, "role.json"), JSON.stringify(config, null, 2) + "\n");
		writeFileSync(join(roleDir, "agent.md"), body.agentMd ?? `# ${roleId}\n\nRole instructions go here.\n`);
		writeFileSync(join(roleDir, "memory.md"), body.memoryMd ?? "");
		const resources = await loadRoleResources(roleDir, runtime.dir);
		runtime.store.upsertRole({
			id: resources.config.id,
			name: resources.config.name ?? roleId,
			kind: resources.config.kind ?? "agent",
			model: resources.config.model ?? null,
			thinkingLevel: resources.config.thinkingLevel ?? "off",
			instanceCount: resources.config.instanceCount ?? 1,
			claimPolicy: resources.config.claimPolicy ?? {},
			mentionPolicy: resources.config.mentionPolicy ?? {},
			roleDir,
		});
		await runtime.agentHost.ensureInstances();
		return json({ id: roleId, roleDir }, 201);
	});
}

/** 更新角色配置与资源文件(role.json / agent.md / memory.md / append_system.md) */
export async function PUT(request: Request, { params }: { params: Promise<{ dirId: string; roleId: string }> }) {
	return handle(async () => {
		await requireAdmin();
		const { dirId, roleId } = await params;
		const runtime = await ensureDirRuntime(dirParam({ dirId }));
		if (!runtime) throw new ApiError(404, "dir not found");
		const role = runtime.store.getRole(roleId);
		if (!role) throw new ApiError(404, "role not found");
		const body = (await request.json()) as {
			role?: Record<string, unknown>;
			files?: Record<string, string>;
		};
		const roleDir = role.roleDir;

		// 1. 合并 role.json 配置
		const current = loadRoleConfig(roleDir) ?? { id: roleId, name: roleId, kind: "agent" };
		const next = { ...current, ...(body.role ?? {}) };
		writeFileSync(join(roleDir, "role.json"), JSON.stringify(next, null, 2) + "\n");

		// 2. 写资源文件(仅允许白名单)
		for (const [name, content] of Object.entries(body.files ?? {})) {
			if (["agent.md", "memory.md", "append_system.md"].includes(name)) {
				writeFileSync(join(roleDir, name), content);
			}
		}

		// 3. 重新注册角色 + 刷新实例
		runtime.store.upsertRole({
			id: roleId,
			name: String(next.name ?? roleId),
			kind: String(next.kind ?? "agent"),
			model: next.model ? String(next.model) : null,
			thinkingLevel: String(next.thinkingLevel ?? "off"),
			instanceCount: Number(next.instanceCount ?? 1),
			claimPolicy: (next.claimPolicy as Record<string, unknown>) ?? {},
			mentionPolicy: (next.mentionPolicy as Record<string, unknown>) ?? {},
			roleDir,
		});
		await runtime.agentHost.ensureInstances();
		return json(runtime.store.getRole(roleId));
	});
}
