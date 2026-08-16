import { existsSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
	JsonlSessionRepo,
	type JsonlSessionMetadata,
	type Session,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createModels, type Models } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { getConfig, dirIdOf, globalRolesDir, projectRolesDir, projectSessionsDir, type PipipiConfig } from "./config";
import { GlobalDb } from "./db/global-db";
import { BoardDb } from "./db/board-db";
import { EventBus } from "./events/event-bus";
import { SseHub } from "./events/sse";
import { AgentHost } from "./agents/agent-host";
import { discoverAndRegisterRoles } from "./agents/resources";
import { createMockProvider } from "./dev/mock-provider";
import { Orchestrator } from "./orchestration/orchestrator";
import { hashPassword } from "./auth";

/** 每目录运行时:DB + 事件 + 会话仓库 + 调度 + 实例 */
export class BoardRuntime {
	readonly store: BoardDb;
	readonly bus: EventBus;
	readonly hub: SseHub;
	readonly sessionRepo: JsonlSessionRepo;
	readonly agentHost: AgentHost;
	readonly orchestrator: Orchestrator;
	readonly dirId: string;

	constructor(
		readonly dir: string,
		readonly boardName: string,
		readonly globalDb: GlobalDb,
		readonly config: PipipiConfig,
		readonly models: Models,
	) {
		this.dirId = dirIdOf(dir);
		this.store = BoardDb.open(dir);
		this.bus = new EventBus();
		this.hub = new SseHub(this.bus);
		this.sessionRepo = new JsonlSessionRepo({
			fs: new NodeExecutionEnv({ cwd: dir }),
			sessionsRoot: projectSessionsDir(dir),
		});
		this.agentHost = new AgentHost(this);
		this.orchestrator = new Orchestrator(this);
	}

	/** 启动编排器 + 发现角色 + 拉起实例(可重复调用) */
	async start(): Promise<void> {
		await discoverAndRegisterRoles(
			this.store,
			globalRolesDir(this.config.dataDir),
			projectRolesDir(this.dir),
			this.dir,
		);
		this.orchestrator.start();
		await this.agentHost.ensureInstances();
	}

	/** 打开(或创建)卡片会话:每卡片一个 durable JSONL session */
	async openCardSession(cardId: number): Promise<Session<JsonlSessionMetadata>> {
		const metas = await this.sessionRepo.list({ cwd: this.dir });
		const existing = metas.find((m) => (m.metadata as { cardId?: number } | undefined)?.cardId === cardId);
		if (existing) return this.sessionRepo.open(existing);
		return this.sessionRepo.create({
			cwd: this.dir,
			metadata: { cardId, board: this.boardName },
		});
	}

	/** @提及统一管线:角色→唤醒,实例→唤醒,用户→通知 */
	async applyMentions(text: string, cardId: number): Promise<void> {
		const names = parseMentions(text);
		if (names.length === 0) return;
		const rolesByName = new Map(this.store.listRoles().map((r) => [r.name, r.id]));
		const seen = new Set<string>();
		for (const name of names) {
			if (seen.has(name)) continue;
			seen.add(name);
			const role = this.store.getRole(name) ?? (rolesByName.has(name) ? this.store.getRole(rolesByName.get(name)!) : undefined);
			if (role && role.kind === "agent") {
				this.orchestrator.wakeRole(role.id, cardId, "mention");
				continue;
			}
			if (this.store.getInstance(name)) {
				const instance = this.store.getInstance(name)!;
				const signal = this.store.enqueueWakeSignal({
					targetRoleId: instance.roleId,
					targetInstanceId: name,
					cardId,
					source: "mention",
					priority: 1,
				});
				if (signal) this.bus.emit({ type: "wake.created", signal });
				this.agentHost.wakeInstance(name, { cardId, source: "mention" });
				continue;
			}
			const user = this.globalDb.getUserByUsername(name);
			if (user) {
				const notification = this.globalDb.createNotification({
					userId: user.id,
					type: "mention",
					dir: this.dir,
					cardId,
				});
				this.bus.emit({ type: "notification.created", notification });
			}
		}
	}
}

export function parseMentions(text: string): string[] {
	return [...text.matchAll(/@([A-Za-z0-9_-]+)/g)].map((m) => m[1]!);
}

// ---------------------------------------------------------------------------
// 全局单例(globalThis 缓存,跨 Next.js 模块缓存存活)
// ---------------------------------------------------------------------------

export interface ServerState {
	config: PipipiConfig;
	globalDb: GlobalDb;
	models: Models;
	runtimes: Map<string, BoardRuntime>;
}

const GLOBAL_KEY = "__pipipi_state";

function getGlobalState(): Record<string, unknown> {
	return globalThis as unknown as Record<string, unknown>;
}

export function getServerState(): ServerState {
	const holder = getGlobalState();
	let state = holder[GLOBAL_KEY] as ServerState | undefined;
	if (state) return state;

	process.on("unhandledRejection", (reason) => {
		console.error("[pipipi] unhandledRejection:", reason);
	});

	const config = getConfig();
	const globalDb = GlobalDb.open(config.dataDir);
	// 内置 provider 目录(与 pi CLI 一致);开发可用 PIPIPI_MOCK_PROVIDER=1 切换 mock
	const models = process.env.PIPIPI_MOCK_PROVIDER === "1" ? createModels() : builtinModels();
	if (process.env.PIPIPI_MOCK_PROVIDER === "1") {
		models.setProvider(createMockProvider());
	}
	state = { config, globalDb, models, runtimes: new Map() };
	holder[GLOBAL_KEY] = state;

	// 首个管理员(环境变量引导)
	if (config.adminUser && config.adminPassword) {
		if (!globalDb.getUserByUsername(config.adminUser)) {
			globalDb.createUser({
				username: config.adminUser,
				displayName: config.adminUser,
				passwordHash: hashPassword(config.adminPassword),
				isAdmin: true,
			});
		}
	}

	// 启动时注册的初始目录
	for (const dir of config.initialDirs) {
		try {
			void initDirRuntime(dir);
		} catch (error) {
			console.error(`[pipipi] failed to init initial dir ${dir}:`, error);
		}
	}

	return state;
}

/** 注册并初始化一个看板目录;已注册则返回既有 runtime */
export async function initDirRuntime(dirPath: string): Promise<BoardRuntime> {
	const state = getServerState();
	const absolute = resolve(dirPath);
	if (!existsSync(absolute)) {
		throw new Error(`directory not found: ${absolute}`);
	}
	const id = dirIdOf(absolute);
	const existing = state.runtimes.get(id);
	if (existing) return existing;

	const runtime = new BoardRuntime(absolute, basename(absolute), state.globalDb, state.config, state.models);
	state.runtimes.set(id, runtime);
	state.globalDb.registerDir(id, absolute, basename(absolute));
	mkdirSync(projectSessionsDir(absolute), { recursive: true });
	await runtime.start();
	return runtime;
}

export function getDirRuntime(dirId: string): BoardRuntime | undefined {
	return getServerState().runtimes.get(dirId);
}

/** 路由用:若内存未加载但已在 DB 注册,则惰性初始化;目录已不存在则视为未注册 */
export async function ensureDirRuntime(dirId: string): Promise<BoardRuntime | undefined> {
	const state = getServerState();
	const existing = state.runtimes.get(dirId);
	if (existing) return existing;
	const dir = state.globalDb.getDir(dirId);
	if (!dir) return undefined;
	if (!existsSync(dir.path)) return undefined;
	return initDirRuntime(dir.path);
}
