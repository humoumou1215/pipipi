# pipipi M1 可执行规格

> 版本: v0.1
> 依据: docs/design.md v0.4
> 目标: 可运行的 MVP——多目录(多看板)、多用户认证、三种认领来源、单角色多实例 worker、每卡片会话、看板工具 + 文件工具、SSE 实时前端。

---

## 0. M1 范围(含边界)

**包含**
- 仓库收纳后结构(§1);Next.js 应用骨架
- 全局用户认证(登录/登出/管理员建号,两级权限:管理员/普通用户)
- 多目录/多看板:`PIPIPI_DIRS` 启动注册 + Web 内注册/切换(切换仅视图,Agent 后台持续运行)
- 列/卡片 CRUD;评论(@解析)、指派、移动、阻塞、验收(通过/驳回,驳回自动排队)
- 三种认领来源:assign / mention / claim(列+优先级+时效打分)
- 单角色多实例;worker 循环;每卡片会话(JSONL);AgentHarness 装配
- 看板工具(§11)+ 文件工具(read/edit/write/bash)
- 全局角色模板 `~/.pipipi/roles/` + 项目角色 `<dir>/.kanban/roles/`(项目覆盖)
- SSE 实时(板级/实例级)、通知铃铛
- 前端:登录页、看板视图、卡片抽屉、Agent 面板、目录切换、用户管理

**不含(M2+)**:角色配置 UI 编辑、memory.md 读写工具与压缩、直聊(fork)、实例会话 scratchpad、用量统计面板、skills/扩展热加载、worktree、沙箱、细粒度权限。

---

## 1. 仓库结构(收纳后)

```
/media/pipipi/                      ← pipipi 仓库根(remote: humoumou1215/pipipi.git)
├── pi/                             ← Pi 源码(整树 git mv,历史保留)
│   ├── packages/  node_modules/  package.json  scripts/  AGENTS.md …
├── docs/                           ← pipipi 文档(design.md, m1-spec.md)
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── layout.tsx  page.tsx  login/page.tsx
│   │   └── api/                    # 见 §6
│   ├── server/                     # 后端核心(非 route)
│   │   ├── config.ts               # 路径/env(PIPIPI_*)
│   │   ├── auth.ts                 # session cookie + bcryptjs
│   │   ├── db/
│   │   │   ├── schema.ts           # DDL(§4)
│   │   │   ├── global-db.ts        # users.db / notifications
│   │   │   └── board-db.ts         # 每目录 board.db + 事务助手
│   │   ├── events/
│   │   │   ├── event-bus.ts        # 每目录 EventBus
│   │   │   └── sse.ts              # SSE Hub(每目录)
│   │   ├── mentions.ts             # @解析(§8)
│   │   ├── orchestration/
│   │   │   ├── orchestrator.ts     # 每目录: 调度 + 兜底扫描 + 监督
│   │   │   ├── claim.ts            # 原子认领 + 策略打分
│   │   │   └── wake.ts             # WakeSignal 队列
│   │   └── agents/
│   │       ├── agent-host.ts       # 每目录实例管理(启停/心跳/恢复)
│   │       ├── worker.ts           # 实例 worker 循环(§9)
│   │       ├── resources.ts        # 角色资源加载(全局+项目合并)
│   │       ├── system-prompt.ts    # 角色 system prompt 组装(§10)
│   │       ├── board-tools.ts      # 看板工具(§11)
│   │       └── env.ts              # ExecutionEnv 适配(node:fs/child_process)
│   └── lib/                        # 前端 hooks/util(useSSE, api, store)
├── public/
├── package.json  next.config.ts  tsconfig.json  .gitignore
```

**收纳执行**:`packages/`、`node_modules/`、根配置文件(AGENTS.md、package.json、tsconfig*.json、scripts/、test.sh、.husky、.github 等)→ `pi/`;`docs/`、`src/` 留在根。**待用户确认时机(当前有活动 pi 会话与未提交改动)。**

---

## 2. 依赖清单

| 包 | 用途 | 版本策略 |
|---|---|---|
| `next` / `react` / `react-dom` | Web 框架 | 与 pi-web 对齐(Next 16.x, React 19.x) |
| `@earendil-works/pi-agent-core` | AgentHarness、JsonlSessionRepository、文件工具、Skill/PromptTemplate | 已发布版本 |
| `@earendil-works/pi-ai` | `createModels()`、Usage | 已发布版本 |
| `@earendil-works/pi-coding-agent` | `loadSkills`、`formatSkillsForPrompt` | 已发布版本 |
| `better-sqlite3` | SQLite(同步事务,原子认领) | 最新稳定 |
| `bcryptjs` | 密码 hash(纯 JS,避免额外原生构建) | 最新稳定 |
| `tailwindcss` | 样式 | v4 |
| `typebox` | 工具 input schema | pi 同版本 |

开发期依赖本地 pi 源码调试时,用 `file:/pi/packages/agent` 等临时覆盖或 `npm link`;发布 package.json 只引用已发布版本(与 pi-web 一致)。

---

## 3. 配置与环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `PIPIPI_DATA_DIR` | 全局数据目录(users.db、全局角色模板、server secret) | `~/.pipipi` |
| `PIPIPI_DIRS` | 启动时注册的看板目录(逗号分隔) | 空(Web 内注册) |
| `PIPIPI_ADMIN_USER` / `PIPIPI_ADMIN_PASSWORD` | 首个管理员(优先于 setup 引导) | 空 |
| `PIPIPI_PASSWORD` | 整体 Basic Auth(pi-web 模式,可选) | 空 |
| `PIPIPI_SECRET` | session cookie 签名密钥;缺省自动生成持久化到 `PIPIPI_DATA_DIR` | 自动 |
| `PIPIPI_PORT` / `PIPIPI_HOST` | `-p` / `-H` 同义 | 3000 / 127.0.0.1 |
| `PIPIPI_SCAN_INTERVAL_MS` | 自由认领扫描间隔 | 30000 |

启动:`pipipi [-H host] [-p port] [--dir path ...]`

---

## 4. 数据库 DDL

### 4.1 全局 `~/.pipipi/users.db`

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,            -- mention / review_request / card_update
  dir TEXT NOT NULL,
  card_id INTEGER,
  activity_id INTEGER,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE dirs (              -- 注册的看板目录
  id TEXT PRIMARY KEY,           -- 规范化路径 hash
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  registered_at TEXT NOT NULL
);
```

### 4.2 每目录 `<dir>/.kanban/board.db`

```sql
CREATE TABLE columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  claimable INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  workflow_role TEXT
);
CREATE TABLE cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'task',
  priority INTEGER NOT NULL DEFAULT 0,          -- 0..4
  tags TEXT NOT NULL DEFAULT '[]',
  column_id INTEGER NOT NULL REFERENCES columns(id),
  status TEXT NOT NULL DEFAULT 'ready',         -- ready/claimed/in_progress/review/blocked/done/archived
  holder_id TEXT,                               -- 当前占用实例(instance id)
  assignee_role TEXT,                           -- 负责人角色(assign 来源)
  stage_idx INTEGER NOT NULL DEFAULT -1,        -- 当前阶段下标(-1 无阶段)
  due_at TEXT,
  review_approver INTEGER,                      -- 验收人 user id(默认创建者)
  version INTEGER NOT NULL DEFAULT 0,           -- 乐观锁
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',       -- pending/in_progress/done
  done_by TEXT,
  position INTEGER NOT NULL
);
CREATE TABLE checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL
);
CREATE TABLE activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  actor_kind TEXT NOT NULL,                     -- user/instance
  actor_id TEXT NOT NULL,
  type TEXT NOT NULL,                           -- created/claimed/commented/mentioned/moved/assigned/blocked/stage_done/review_approve/review_reject/error/...
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE wake_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_role_id TEXT NOT NULL,
  target_instance_id TEXT,
  card_id INTEGER,
  source TEXT NOT NULL,                         -- assign/mention/claim/manual
  priority INTEGER NOT NULL DEFAULT 0,          -- assign=2, mention=1, claim=0
  status TEXT NOT NULL DEFAULT 'pending',       -- pending/queued/processing/done
  dedupe_key TEXT,                              -- role:card:source 去重
  created_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'agent',           -- agent/human
  model TEXT,                                   -- 模型 id
  thinking_level TEXT NOT NULL DEFAULT 'off',
  instance_count INTEGER NOT NULL DEFAULT 1,
  claim_policy TEXT NOT NULL DEFAULT '{}',      -- JSON(§9.3)
  mention_policy TEXT NOT NULL DEFAULT '{}',
  role_dir TEXT NOT NULL,                       -- 实际生效目录(项目优先)
  updated_at TEXT NOT NULL
);
CREATE TABLE instances (
  id TEXT PRIMARY KEY,                          -- '{roleId}-{idx}'
  role_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',          -- idle/working/chat/error/stopped
  current_card_id INTEGER,
  queue_len INTEGER NOT NULL DEFAULT 0,
  heartbeat_at TEXT NOT NULL,
  UNIQUE(role_id, idx)
);
CREATE TABLE usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id TEXT, instance_id TEXT, card_id INTEGER,
  model TEXT,
  input_tokens INTEGER, output_tokens INTEGER,
  cache_read INTEGER, cache_write INTEGER, cost REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE memory_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id TEXT NOT NULL,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual',
  source_card_id INTEGER,
  created_at TEXT NOT NULL
);
```

默认列种子(每目录首次初始化):`Backlog(不可认领) → Ready(可认领) → In Progress(可认领,绑定流转) → In Review → Done(完成态)`。

---

## 5. 认证与用户

- `POST /api/auth/setup {username, password}`:首个管理员(仅当 users 表为空,或由 `PIPIPI_ADMIN_USER/PASSWORD` 环境变量直接创建)。
- `POST /api/auth/login {username, password}` → `Set-Cookie: pipipi_session=<signed>`;cookie = `base64(json{uid, exp}) + HMAC-SHA256`(`PIPIPI_SECRET`),7 天。
- `POST /api/auth/logout`;`GET /api/auth/me`。
- 管理端:`GET /api/users`、`POST /api/users {username, displayName, password, isAdmin}`、`DELETE /api/users/:id`(仅管理员;不能删自己)。
- 权限:`requireUser`(任意登录)、`requireAdmin`。普通用户可操作卡片/评论/唤醒;管理员可管理用户、注册目录、编辑列。
- 可选 `PIPIPI_PASSWORD` → 全应用 Basic Auth(pi-web 模式),与登录并存(先 Basic 后 cookie)。

---

## 6. REST API 清单

> 前缀 `/api`;所有 `dir` 资源用 `dirId`(路径 hash)定位;需登录(除 auth 三接口)。

**认证/用户**
```
POST /auth/setup | /auth/login | /auth/logout
GET  /auth/me
GET  /users | POST /users | DELETE /users/:id          (admin)
```

**目录/看板**
```
GET  /dirs                                          → [{id, path, name, summary{cards, instances}}]
POST /dirs {path, name}                             → 注册(校验目录、初始化 .kanban/board.db + 默认列 + 启动 runtime)
GET  /dirs/:dirId/board                             → 快照{columns, cards, roles, instances}
GET  /dirs/:dirId/events                            → SSE(板级)
```

**列/卡片**
```
POST /dirs/:dirId/columns {name, position, claimable, done}   (admin)
PUT  /dirs/:dirId/columns/:colId
POST /dirs/:dirId/cards {title, description?, type?, priority?, tags?, columnId?, assigneeRole?, reviewApprover?}
GET  /dirs/:dirId/cards/:cardId                     → 详情(含 stages/checklist/activities)
PUT  /dirs/:dirId/cards/:cardId {fields}            (乐观锁 version)
POST /dirs/:dirId/cards/:cardId/move {columnId}
POST /dirs/:dirId/cards/:cardId/comment {text}      (解析 @)
POST /dirs/:dirId/cards/:cardId/assign {roleId}
POST /dirs/:dirId/cards/:cardId/block {reason} | /unblock
POST /dirs/:dirId/cards/:cardId/review {action:approve|reject, comment?}   (仅验收人/管理员)
POST /dirs/:dirId/cards/:cardId/wake {message?}     (人工唤醒 assignee 或指定角色)
```

**角色**
```
GET  /dirs/:dirId/roles                             → 合并后的角色列表(全局+项目)
GET  /dirs/:dirId/roles/:roleId                     → 定义 + agent.md/memory.md 内容
POST /dirs/:dirId/roles/:roleId/scaffold {model?}   (admin) 创建角色目录模板
```

**实例/通知/用量**
```
GET  /dirs/:dirId/instances                         → 实例状态列表
POST /dirs/:dirId/instances/:instanceId/wake {message?}
POST /dirs/:dirId/instances/:instanceId/abort
GET  /instances/:instanceId/events                  → SSE(实例级 harness 事件)
GET  /notifications?unread=1 | POST /notifications/:id/read | POST /notifications/read-all
GET  /usage?dir=&role=&since=                       → 汇总(占位,M2 完善)
```

---

## 7. SSE 事件协议

连接即推送快照,之后只推增量;断线重连重新拉快照(不重放)。

```
GET /dirs/:dirId/events
  → {type:"snapshot", board:{...}}
  → {type:"card.updated", card:{...}}        卡片任何字段/状态变化
  → {type:"activity.created", activity:{...}}
  → {type:"instance.updated", instance:{...}} 状态/当前卡片/队列
  → {type:"agent.stream", cardId, instanceId, event:{message_update...}} 流式消息(节流)
  → {type:"wake.created", signal:{...}}
  → {type:"notification.created", notification:{...}}   (仅当前用户)
  → ": ping" 每 30s 保活

GET /instances/:instanceId/events
  → harness 原始事件(message_start/update/end, tool_execution_*, turn_*, agent_end)
```

前端 `useSSE(dirId)`:EventSource → snapshot 初始化 store,事件走 reducer;`agent.stream` 节流 100ms 渲染。

---

## 8. @提及解析

- 触发位置:评论(`/comment`)、卡片描述、人工唤醒消息。
- 正则:`/@([A-Za-z0-9_-]+)/g`;解析顺序:
  1. **实例名**(`{roleId}-{idx}`,如 `dev-1`)→ 直接入该实例队列(WakeSignal priority=1)。
  2. **角色名**(roles 表)→ 生成 WakeSignal(target_role_id=role, source=mention, priority=1);派发时挑空闲实例(轮询最少队列);无空闲则 pending 排队。
  3. **用户名**(users 表)→ 写 notification(不产生认领)。
- 去重:`dedupe_key = role:card:source`,同一 pending 只保留一条。
- 活动时间线中 @ 渲染为可点击;`@角色名` 悬停显示角色信息。

---

## 9. 认领/唤醒管线与 worker

### 9.1 任务来源与优先级

| source | priority | 触发 | 语义 |
|---|---|---|---|
| assign | 2 | `assignee_role` 设置 / 阶段完成流转 | 必须处理 |
| mention | 1 | @角色/@实例 | 必须查看 |
| manual | 1 | 人工唤醒(带消息) | 必须查看 |
| claim | 0 | 定时扫描 | 可选(策略打分) |

### 9.2 原子认领

```sql
BEGIN IMMEDIATE;
UPDATE cards SET holder_id=?, status='claimed', version=version+1, updated_at=?
WHERE id=? AND holder_id IS NULL AND status='ready'
  AND column_id IN (SELECT id FROM columns WHERE claimable=1);
-- affected=0 → 失败(竞争/不可认领)
COMMIT;
```
assign/mention/manual:不竞争,直接 `bindCard`(置 holder + status='claimed'),失败(卡片已删除/已完成)则丢弃。

### 9.3 claim 策略打分(M1)

```
candidates = cards WHERE status='ready' AND column.claimable=1
              AND 满足 role.claim_policy(列白名单/类型/标签/优先级>=阈值,可配)
score = priority * 10 + ageHours * 0.5 + jitter(0..1)     # 负载均衡扰动
取最高分;实例一次只取一张。
```

### 9.4 Worker 循环(每目录每实例)

```ts
class InstanceWorker {
  private queue: Task[] = [];        // assign/mention/manual,按 priority 排序
  busy = false;

  async run() {
    while (!this.stopped) {
      if (this.busy) { await sleep(500); continue; }
      const task =
        this.queue.shift() ??
        (await takePendingSignal(this.roleId, this.id)) ??   // wake_signals 认领自己的
        (await this.scanClaim());                            // 自由认领
      if (!task) { await sleep(scanInterval); continue; }
      this.busy = true;
      try { await this.work(task); }
      catch (e) { await recordError(task.cardId, e); }
      finally {
        await this.releaseCard();
        this.busy = false;
      }
    }
  }

  private async work(task: Task) {
    if (task.source === "claim" && !(await tryClaim(task.cardId))) return;
    await bindCard(task.cardId);                  // assign/mention/manual 直接绑定
    this.setStatus("working", task.cardId);
    const session = await openCardSession(task.cardId);       // JSONL 每卡片
    const harness = await createHarness(this.role, session);  // §10
    try {
      await harness.prompt(buildTaskInstruction(task));       // 第一条 user 消息
      await harness.waitForIdle();
      await this.report(task.cardId);   // 写活动;complete_stage 由 Agent 工具调用
    } finally {
      await harness.requestShutdown();
      await harness.waitForShutdown().catch(() => {});
      await this.releaseCard();         // holder=null;若卡片仍在原列且非 done → status=ready
    }
  }
}
```

### 9.5 Orchestrator(每目录)

- 订阅 EventBus:card.created/moved/commented/assigned、stage.done → 生成 WakeSignal 并唤醒(§9.1)。
- 兜底定时器(scanInterval):处理漏信号、回收过期认领(holder 心跳 TTL 5min → status 回 ready + 活动"认领超时")、重估 claim 候选。
- 实例监督:按 roles.instance_count 启动/补齐;异常退出指数退避重启;启动时接管失效认领。
- **切换目录不停止任何 runtime**;每个目录的 Orchestrator 常驻。

### 9.6 验收与驳回

- Agent `request_review` → 卡片移到 In Review + 活动 + @验收人 notification(priority=1)。
- 验收人 `approve` → status=done → 卡片移到 Done 列。
- `reject` → 卡片回原处理列 + 活动 + @原处理角色(WakeSignal source=mention,priority=1;**无空闲实例则自动排队**)。

---

## 10. 每卡片会话与 Harness 装配

### 10.1 会话

- 路径:`<dir>/.kanban/sessions/<cardId>.jsonl`。
- `JsonlSessionRepository`(pi-agent-core)提供 fs 适配接口;实现 node:fs 适配(append/read/list)。
- 认领时:session 存在则 open,不存在则 create(`cwd` = 看板目录)。
- 释放时:`harness.requestShutdown()`;会话数据持久化,下次认领复用。

### 10.2 Harness 装配

```ts
const models = createModels();                    // 进程级单例(所有 dir/实例共享)
const harness = new AgentHarness({
  session,
  models,
  model: resolveModel(role.model),                // 从模型目录解析
  thinkingLevel: role.thinkingLevel,
  tools: [
    ...createBoardTools({ store, role, instance }), // §11
    createReadTool({ env }), createWriteTool({ env }),
    createEditTool({ env }), createBashTool({ env }),
  ],
  toolContext: { store, role, instance, env },     // env = ExecutionEnv(node:fs/child_process, cwd=dir)
  resources: { skills, promptTemplates },          // 角色目录加载
  systemPrompt: buildRoleSystemPrompt(role),       // §10.3
  streamOptions: { cacheRetention: "long" },       // §7.3 缓存策略
});
```

### 10.3 system prompt 组装(缓存稳定块优先)

```
<role-agent>   # agent.md 全文(稳定)
<role-memory>  # memory.md 全文(低频更新)
<board-tools>  # 看板工具说明(工具 snippets + 使用守则,稳定)
<append>       # append_system.md(稳定)
当前工作目录: <dir>
```
任务指令(卡片标题/阶段/唤醒消息/目标)**一律作为第一条 user message**,不进 system prompt。

### 10.4 资源加载

- 角色目录解析:`<dir>/.kanban/roles/<id>/` 存在则用项目版;否则回退 `~/.pipipi/roles/<id>/`(全局模板);`role_dir` 字段记录实际生效目录。
- skills:`loadSkills`(pi-coding-agent)或最小实现:遍历 `<roleDir>/skills/**/SKILL.md`,解析 frontmatter(name/description)。
- promptTemplates:遍历 `<roleDir>/prompts/*.md`(M2 完整接入,先行占位)。
- 角色首次被引用时注册进 roles 表(scaffold 或自动发现)。

---

## 11. 看板工具集(createBoardTools)

每个工具 `{ name, description, inputSchema: typebox, execute(toolCallId, params, signal, onUpdate, ctx) }`;ctx = `{ store, role, instance }`;所有变更走 boardDb 事务;读操作可并发。

| name | input | 说明 |
|---|---|---|
| `board_state` | `{columns?, roles?}` | 看板快照(列/卡片计数/实例状态) |
| `list_cards` | `{column?, status?, role?, mine?}` | 查询(带筛选) |
| `read_card` | `{cardId}` | 详情 + 时间线 + 阶段 + 负责人/验收人 |
| `claim_card` | `{cardId}` | 自由认领(仅可认领列) |
| `update_card` | `{cardId, fields}` | 标题/描述/优先级/tags(乐观锁) |
| `comment_card` | `{cardId, text}` | 评论;支持 @(走 §8 管线) |
| `complete_stage` | `{cardId}` | 完成当前阶段 → 推进下一阶段列 → assign 流转 |
| `move_card` | `{cardId, columnId}` | 移动(按列权限) |
| `assign_card` | `{cardId, roleId}` | 指定负责人 + assign 唤醒 |
| `request_review` | `{cardId}` | 移 In Review + @验收人 |
| `add_checklist` / `update_checklist` | `{cardId, ...}` | 清单 |
| `mark_blocked` / `unblock` | `{cardId, reason?}` | 阻塞 |

文件工具(`createReadTool` 等)经 `ExecutionEnv` 适配,`cwd` = 看板目录;bash 默认 `timeout`、工作目录限制(沙箱 M3)。

---

## 12. 前端页面与组件

```
/login                    LoginPage
/                         BoardPage(登录守卫)
  ├─ DirSwitcher          目录下拉切换;切换仅换 SSE 订阅与视图
  ├─ BoardView            ← 列(Column)+ 卡片(CardItem);HTML5 DnD 拖拽移动
  ├─ CardDrawer           卡片详情:描述/清单/阶段进度/ActivityTimeline/CommentBox(@补全)/验收按钮
  ├─ AgentPanel           角色分组实例卡片:状态/当前卡片/队列;wake(带消息)/abort
  ├─ NotificationBell     未读铃铛 + 下拉(mention/review 请求)
  └─ AdminModal           用户管理(admin)、目录注册(admin)
```

状态:`lib/store.ts`(reducer,由 SSE 驱动)+ `lib/api.ts`(fetch 封装)+ `lib/useSSE.ts`。样式:tailwind;渲染:react-markdown + 代码高亮(轻量)。@补全:输入 `@` 弹出候选(角色/实例/用户)。

---

## 13. M1 验收清单

- [ ] `npm run dev` 启动;`PIPIPI_ADMIN_USER/PASSWORD` 创建管理员并登录
- [ ] 注册两个目录;切目录仅视图切换,Agent 均后台运行
- [ ] 建列/建卡片(带阶段/验收人默认创建者);卡片可改/移/阻塞
- [ ] 全局角色模板 + 项目角色覆盖生效;scaffold 建角色;实例按 instance_count 启动
- [ ] @角色/@实例 唤醒;忙碌时排队;assign 流转必处理;claim 定时认领
- [ ] Agent 处理卡片:read_card → 改文件 → comment(@) → complete_stage → request_review
- [ ] 验收 approve→Done;reject→回处理列 + @原角色(忙则排队)
- [ ] SSE:板级/实例级事件实时;断线重连拉快照
- [ ] 通知铃铛:mention/review 请求未读 + 已读
- [ ] 每卡片会话 JSONL 生成;卡片接力时上下文完整
- [ ] 崩溃恢复:kill 进程重启,过期认领回收,实例重建

---

## 14. 风险与待验证

1. **每卡片 harness 创建开销**:认领→open session→new AgentHarness 的延迟与内存;若成为瓶颈,实例池化 harness(按卡片会话切换,M2)。
2. **better-sqlite3 原生模块**:Next.js standalone 打包需配置 externals;node_modules 与原生 .node 文件需随 standalone 分发。
3. **ExecutionEnv 适配完整性**:node:fs/child_process 覆盖 FileSystem+Shell 接口;图片处理等可选能力 M1 不接。
4. **多目录并发**:所有目录共享进程内 `createModels` 单例;每目录独立 DB/EventBus/SSE,无共享可变状态。
5. **SSE 长连接**:每目录一 Hub;连接数预警与重连退避(参照 pi-web)。
6. **会话文件增长**:done 卡片会话保留(M3 归档策略)。
7. **Agent 工具误用风险**:update_card/complete_stage 等写工具按角色裁剪 + 操作审计(活动即审计)。
