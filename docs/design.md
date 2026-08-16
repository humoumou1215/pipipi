# pipipi — 看板 Agent 协作平台(整体设计)

> 版本: v0.4(设计稿)
> 项目目录: `/media/pipipi/`(pipipi 仓库根;Pi 源码收纳于 `pi/` 子目录,部署形态参照 pi-web:独立 npm 包 + Next.js standalone + 单 Node 常驻进程)
> 定位: Web 应用,用户与多角色 Agent 通过"看板"协作。Agent 按角色定义(agent.md / memory.md / skills / extensions / prompts),可写代码/执行任意文件操作;卡片经"指派/@提及/自由认领"三种来源驱动,一个卡片可被多个 Agent 接力;一个 Agent 实例同时只处理一件事;同一角色可配置多个实例;多用户 + 简单认证。

---

## 1. 背景与目标

- 形态与 pi-web 一致:独立 npm 包、单 Node 常驻进程、Next.js 提供 Web UI + REST + SSE。
- **一个目录 = 一个看板**:启动时(或 Web 内)选择工作目录,看板数据、角色资源、卡片会话都落在该目录下,随目录走。
- 交互媒介是**看板**:卡片是工作单元,人在看板上创建/评论/验收,Agent 在看板上认领、处理、流转。
- **Agent 是全能的**:默认带文件工具(read/edit/write/bash),可以写代码、改文档、执行命令。
- **协作通过 @提及 与 指派 驱动**:用户可 @agent、@用户;agent 也可 @agent、@用户。@=唤醒/通知。
- 底层复用 Pi 生态:
  - `@earendil-works/pi-agent-core`:`Agent` / `AgentHarness`、agent loop、会话、compaction、技能、工具
  - `@earendil-works/pi-ai`:`createModels()`、模型目录、provider 认证、用量统计、prompt 缓存
  - `@earendil-works/pi-coding-agent`:`DefaultResourceLoader`(AGENTS.md/SKILL.md/扩展/prompt 模板)、`buildSystemPrompt`、文件/bash 工具
  - pi-web:Next.js API routes + SSE + React 前端的成熟模式

### 非目标(当前版本)
- 不做跨进程/多机分布式(单进程托管所有 Agent 实例)。
- 不做通用工作流引擎;只做"卡片 + 阶段 + 三种认领来源"这层编排。

---

## 2. 总体架构

```
┌────────────────────────────────────────────────────────────┐
│            pipipi 单 Node 常驻进程 (Next.js)                │
│                                                            │
│  ┌──────────────┐   ┌───────────────┐   ┌───────────────┐  │
│  │  HTTP API    │   │  SSE Hub      │   │  EventBus     │  │
│  │  (REST)      │   │  (实时推送)     │   │  (板事件)      │  │
│  └──────┬───────┘   └───────┬───────┘   └───────┬───────┘  │
│         │                   │                   │          │
│  ┌──────▼───────────────────▼───────────────────▼───────┐  │
│  │                    BoardStore (SQLite)               │  │
│  │  板/列/卡片/阶段/活动/唤醒信号 —— 事务保证原子认领      │  │
│  └──────────────────────────┬───────────────────────────┘  │
│                             │ 事件 / 查询                  │
│  ┌──────────────────────────▼───────────────────────────┐  │
│  │            Orchestrator(调度 + 监督 + 认领策略引擎)    │  │
│  │   · 认领来源: assign(指派) / mention(@提及) / claim   │  │
│  │   · 事件驱动唤醒 + 定时兜底扫描                        │  │
│  │   · 实例生命周期管理(按角色 instanceCount 启停)        │  │
│  └──────────────────────────┬───────────────────────────┘  │
│                             │                              │
│  ┌──────────────────────────▼───────────────────────────┐  │
│  │          AgentHost(每实例一个 AgentHarness)           │  │
│  │   · worker 循环: 认领→打开卡片会话→处理→上报→释放      │  │
│  │   · 资源: 角色 agent.md/memory.md/skills/extensions   │  │
│  │   · 看板工具 + 文件工具(read/edit/write/bash)          │  │
│  │   · 直聊: fork 会话,不进入主流程                       │  │
│  └──────────────────────────┬───────────────────────────┘  │
│                             │                              │
│              ┌──────────────▼──────────────┐               │
│              │   pi-ai Models / Providers  │               │
│              └─────────────────────────────┘               │
└────────────────────────────────────────────────────────────┘
        ▲                                      ▲
        │ REST + SSE + 登录                      │ 静态资源
  ┌─────┴──────────────────────┐    ┌───────────┴───────────┐
  │  React 前端(看板)           │    │  <dir>/.kanban/        │
  │  · 看板/卡片详情/通知铃铛     │    │  board.db  sessions/   │
  │  · Agent 面板(直聊)/角色配置  │    │  roles/  memory.md     │
  └────────────────────────────┘    └───────────────────────┘
```

---

## 3. 目录与看板

- **一个目录 = 一个看板**。启动参数 `--dir <path>`(或 Web 内选择/切换,M2)。
- 看板数据落在目录下:
  ```
  <dir>/.kanban/
  ├── board.db        # SQLite:板/列/卡片/阶段/活动/唤醒/用量
  ├── sessions/       # 每卡片 JSONL 会话(AgentHarness durable session)
  └── roles/          # 角色资源目录(见 §4),随看板走
  ```
- 角色资源两级:**全局模板** `~/.pipipi/roles/<id>/`(跨看板共享)+ **项目角色** `<dir>/.kanban/roles/<id>/`(项目覆盖全局,M1 支持)。
- 用户认证/账号**全局**(`~/.pipipi/users.db` 或配置文件),跨目录共享。
- **Web 内切换目录(M1)**:同一进程可同时挂载多个目录(多个看板);切换目录**只是前端视图切换**,各目录的 EventBus/SSE 流与 Agent 实例独立,**后台默认持续运行**。
- 工作目录本身建议是 git 仓库,Agent 的文件工具在其下工作。

---

## 4. 领域模型

### 4.1 实体

| 实体 | 说明 | 关键字段 |
|---|---|---|
| **Board** | 看板(= 目录) | dir, name, columns[], stageTemplates[], settings |
| **Column** | 列 | id, name, order, workflowRole(可选绑定角色), claimable(可自由认领), done(完成态) |
| **Card** | 卡片(工作单元) | id, boardId, title, description, type, priority, tags, columnId, status(ready/claimed/in_progress/review/blocked/done/archived), holderId(当前占用实例), assigneeRole(负责人角色), stageIdx, stages[], checklist[], dueAt, reviewApprover(验收人,默认=创建者,可改), version(乐观锁) |
| **Stage** | 卡片阶段(接力点) | id, roleId(负责角色), title, description, requiredSkills[], checklist[], status(pending/in_progress/done), doneBy |
| **Role** | Agent 角色定义 | id, name, kind(agent/human), model, thinkingLevel, instanceCount, claimPolicy, mentionPolicy, workingHours, resourcePaths |
| **AgentInstance** | 实例(运行时) | id, roleId, index, status(idle/working/chat/error/stopped), currentCardId, queue[], heartbeatAt, usageTotals |
| **User** | 人类用户(登录账号,全局) | id, username, displayName, passwordHash, avatar, isAdmin, createdAt |
| **Activity** | 卡片活动(时间线) | id, cardId, actorId, actorKind(user/instance), type(created/claimed/commented/mentioned/updated/moved/stage_done/assigned/blocked/memory/...), payload, timestamp |
| **WakeSignal** | 唤醒信号 | id, targetRoleId, targetInstanceId?, cardId?, source(mention/assign/claim/manual/periodic), priority, status(pending/queued/processing/done), createdAt, processedAt |
| **Notification** | 用户通知 | id, userId, type(mention/review_request/card_update), cardId?, activityId?, read, createdAt |
| **MemoryEntry** | 角色长期记忆 | roleId, content, kind(manual/summary/lesson), sourceCardId?, createdAt |

### 4.2 卡片状态机

```
               用户/规则           指派或认领(原子)         处理完成
  Backlog ──────────► Ready ────────────► In Progress ────────► (阶段完成)
   ▲                    │                     │                  │
   │                    │                     ▼                  │
   │                    │               blocked ◄──► in_progress │
   │                    │                                         ▼
   │                    │                            下一阶段 / 待验收 Review
   │                    │                                         │
   └─────── 重新打开 ◄──┴────────── 未通过验收 ◄───────────────────┘
                                                                  ▼
                                                              Done → Archive
```

- 阶段完成 → 卡片推进到下一阶段列 → 触发 **assign** 流转(唤醒下一角色)。
- 待验收:`reviewApprover`(默认 = 创建该卡片的用户,卡片详情可修改)收到 Notification;通过 → Done,驳回 → 回处理列并 @处理角色。

### 4.3 三种认领/处理来源(核心机制)

| 来源 | 触发方式 | 行为 | 优先级 |
|---|---|---|---|
| **assign 指派** | `assigneeRole` 被设置;或阶段完成、负责人流转到下一角色 | **必须处理**:直接进该角色实例高优先队列,不参与竞争 | 最高 |
| **mention 提及** | 评论/描述中 `@角色`/`@实例`(用户或 Agent 发出) | **必须查看**:空闲实例立即处理;忙碌则排队 | 高 |
| **claim 自由认领** | 定时扫描可认领列 | **可选**:按策略打分排序竞争 | 低 |

- `@用户名` 不产生认领,只产生 Notification(SSE 提醒)。

---

## 5. 角色与资源配置

每个角色对应一个资源目录(复用 pi 资源加载机制);加载顺序:**项目角色覆盖全局模板**(同名角色合并,项目文件优先,缺失项回退全局模板):

```
roles/<role-id>/
├── agent.md          # 角色职责/行为规范/输出契约(等价 AGENTS.md,进 system prompt)
├── memory.md         # 长期记忆(进 system prompt,Agent 可经工具追加/总结)
├── skills/           # SKILL.md 技能(agentskills.io 规范,pi 原生加载)
├── extensions/       # pi extension 目录(自定义工具/命令)
├── prompts/          # prompt 模板(可被调度器/用户显式调用)
├── system.md         # 可选,覆盖默认 system prompt
└── append_system.md  # 可选,追加到 system prompt
```

- 全局模板目录 `~/.pipipi/roles/<id>/`,可被多个看板引用;项目目录 `<dir>/.kanban/roles/<id>/` 优先。

角色配置(存 DB,提供 UI):
- **模型**:model id + thinking level;不同角色可用不同模型/供应商。
- **instanceCount**:并发实例数;实例无共享状态,靠原子认领竞争。
- **claimPolicy**:自由认领规则(可配多条):匹配列/卡片类型/标签/技能要求/优先级阈值,打分权重;可选工作时段、每小时上限(M2)。
- **mentionPolicy**:是否接受 @唤醒、静默期(防抖)。
- **工具集**:默认看板工具(§8)+ 文件工具(read/edit/write/bash,默认全开);bash 可选沙箱。
- **工作目录**:看板目录(可配子目录/卡片 worktree,参照 pi-web worktrees,M3)。

---

## 6. Agent 实例运行模型

### 6.1 一次只做一件事

- pi `Agent`/`AgentHarness` 固有约束:`prompt()` 在 active run 期间抛错;`AgentHarness` 在非 idle phase 拒绝新结构操作。
- 上层 Worker 状态机严格串行:**取任务 → 认领/绑定卡片 → 打开卡片会话 → 处理 → 上报 → 释放**。
- 直聊(fork 会话)也占实例(状态 `chat`),与卡片工作互斥。

### 6.2 Worker 循环

```
loop:
  wait(唤醒事件 或 定时 tick)
  if status != idle: continue                        # 一次一件事
  task = queue.popHighestPriority()                  # assign/mention/claim 排序
  if task 是 claim 类型: tryClaim(card) 失败则 continue
  if task 是 assign/mention: 卡片直接绑定到本实例(不经竞争)
  status = working; currentCardId = card.id
  session = openCardSession(card.id)                 # 每卡片会话(§7)
  harness = createHarness(role, session)             # 绑定卡片会话
  try:
    harness.prompt(buildTaskPrompt(card, task))      # 最小任务指令,详情由工具读取
    await harness.waitForIdle()
    report(card, task)                               # 写活动/推进阶段/触发流转
  catch e: recordError(card, e); 必要时 retry
  finally:
    harness.requestShutdown(); await waitForShutdown()
    releaseClaim(card); status = idle; currentCardId = null
  sleep(scanInterval) 或 等待下个唤醒事件
```

- 唤醒发生在处理中:任务入 `queue[]`,当前 run 结束后处理。

### 6.3 唤醒(Wake)

来源与优先级:
1. **assign(指派/流转)**:卡片负责人流转到本角色 → 最高优先,必须处理。
2. **mention(@提及)**:评论/描述中 @本角色或 @本实例 → 高优先,必须查看。
3. **claim(定时扫描)**:周期性扫描可认领列 → 按策略打分。
4. **manual(人工唤醒)**:Agent 面板"唤醒+留言" → 等同 mention。

@提及由服务器统一解析(§9.2),用户和 Agent 的提及走同一管线。

### 6.4 直聊(fork 会话)

- Agent 面板提供"与实例直接对话":**fork 源可选**——(a) 从指定卡片的会话 fork;(b) 从实例自身上下文 fork(实例会话,见 §7.4);(c) 空白会话。**不写回卡片主会话,不进入看板主流程**(对应 pi 的 fork 语义)。
- 状态为 `chat` 的实例不接受新的卡片任务,直聊结束后恢复。
- 实现:复用 pi `SessionRepository.fork()` / harness 的 branch 能力。

---

## 7. 会话与上下文(关键决策)

### 7.1 会话归属:**每卡片一个会话**(已确认)

- 每张卡片一个 durable JSONL 会话(`AgentHarness` + `JsonlSessionRepository`),所有处理过该卡片的实例的工作都写进这个会话,接力共享。
- **单写者由认领保证**:一张卡片同一时刻只有一个实例持有并写入。
- 实例认领时打开卡片会话并创建绑定它的 harness;释放时销毁 harness(会话数据持久化在 `<dir>/.kanban/sessions/`)。
- 唤醒消息(@提及、指派、人工留言)都挂在卡片上 → 作为 run 的起始消息注入该卡片会话。

### 7.2 上下文策略

- 系统提示词:复用 `buildSystemPrompt`:
  ```
  [role.agent.md]            ← 角色指令(稳定块)
  [role.memory.md]           ← 长期记忆(动态块,低频更新)
  [看板工具说明]              ← 工具 snippets + guidelines(稳定块)
  [append_system.md]         ← 可选(稳定块)
  [当前工作目录]              ← 看板目录
  ```
- **最小任务指令**:每次 run 只注入"任务指令"(卡片标题 + 当前阶段 + 负责人 + 唤醒消息 + 目标)作为**第一条 user message**;卡片详情/历史/评论由 Agent 用 `read_card` 等工具按需读取——**卡片内容绝不进 system prompt**(缓存要求,见 §7.3)。
- **记忆(memory.md)**:初始内容进 system prompt;`append_memory` 工具追加(仅 run 结束时写入,低频);超限时用 pi summarization 压缩归档旧条目。
- 上下文压缩:卡片会话由 harness 内置 compaction 控制长度。

### 7.3 缓存与成本(每卡片会话的缓存分析)

**结论:每卡片会话不会降低缓存命中率;多人接力不破坏前缀命中;且命中质量(缓存内容是否有用)优于每实例会话。**

**缓存机制(pi-ai 实现)**:
- 缓存是**内容寻址 + 前缀匹配**,不是按会话寻址。`cacheRetention` 在 Anthropic 上给 system prompt、最后一个工具定义、最后一条 user 消息打 `cache_control`(ephemeral 或 1h ttl);OpenAI 为自动前缀缓存。
- 命中条件 = **请求开头与某次已缓存前缀完全一致**。断点随会话推进(每次请求把 cache_control 打到最新一条 user 消息),因此"前缀"就是当前请求之前的全部内容。

**接力场景走查(回答"切换 agent 会不会难命中")**:
- 角色 A 处理卡片 X(模型 M):请求 1 miss(新前缀,但 sys(A) 块按内容命中);请求 2、3… 前缀递增 → 命中。
- 角色 B(不同模型/系统提示词)接手:请求 1 对历史部分 miss(B 从未请求过该前缀;不同模型的缓存互不相通,任何方案都一样);B 的请求 2、3… 前缀递增 → 命中。
- **同角色回访**(A 或 A 的另一实例回到卡片 X):请求前缀开头与 A 上次缓存严格一致 → **命中**;B 追加在后的内容不影响 A 的前缀命中。
- 结论:**只要会话 append-only,任何接手者的 run 内部都前缀命中;交换接手者不破坏命中。** 会话内容混合正是接力者需要的信息,不是缓存障碍。

**命中率 vs 命中有用性(关键区分)**:
- 每实例会话确实"命中率高":处理卡片 2、3… 时,前缀包含前面所有卡片的内容 → 每次都命中。但命中的是**无用内容**,每个请求都在以 cache-read 价读垃圾,还填满上下文窗口、更快触发 compaction;而 **compaction(摘要替换旧消息)才是真正的缓存杀手**:前缀整体失效 + 额外总结成本。
- 每卡片会话:sys 块跨卡片/跨实例命中(内容寻址);卡片内 run 前缀命中;同角色回访近乎全前缀命中;上下文干净 → compaction 频率低。**缓存质量全面胜出。**

**其余推论**:
- sessionId 差异只影响 provider 的"会话亲和路由"提示;单进程部署无影响。
- 不同角色不同模型/系统提示词,缓存天然隔离,互不干扰。

**缓存杀手与规避规则**:
1. 卡片动态内容注入 system prompt → 换卡片即变前缀。**规则:任务指令走 user message,不进 system prompt。**
2. memory.md 频繁变更 → 变一次失效一次。**规则:仅 run 结束时低频写;system prompt 中稳定块与 memory 分块,provider 支持时稳定块单独打 1h ttl。**
3. 请求间隔超过 retention(5min/1h)→ 过期;任何方案共有,靠多实例并发/高频活动提高命中。

### 7.4 分层会话(回应"每实例一个会话")

每实例会话的价值保留,但不承载卡片上下文:
- **卡片会话**:工作区(主),多人接力共享,缓存见 §7.3。
- **实例会话(M2,与直聊一起上)**:实例私有 scratchpad(跨卡片心得/未完成计划,Agent 工具可读写)+ 直聊的 agent 源 fork 基座;不进模型上下文或按需注入。
- **角色 memory.md**:共享记忆(角色内所有实例共用)。

---

## 8. 工具集

注入到每个 Agent(默认全量;按角色可裁剪):

**看板工具**

| 工具 | 说明 |
|---|---|
| `board_state(columns?, roles?)` | 看板快照(列、卡片计数、实例状态) |
| `list_cards(column?, status?, role?, mine?)` | 查询卡片(筛选) |
| `read_card(cardId)` | 卡片详情 + 活动时间线 + 阶段 + 负责人 + 验收人 |
| `claim_card(cardId)` | 自由认领(原子;只能认领本角色可认领的) |
| `update_card(cardId, fields)` | 更新标题/描述/优先级/tags(乐观锁) |
| `comment_card(cardId, text)` | 评论;**支持 @提及**(@角色/@实例/@用户 → 自动唤醒/通知) |
| `complete_stage(cardId)` | 完成当前阶段 → 推进下一阶段 → 触发 assign 流转 |
| `move_card(cardId, columnId)` | 手动移动卡片(按权限) |
| `assign_card(cardId, roleId)` | 指定负责人并唤醒(assign 来源) |
| `request_review(cardId)` | 评论 @验收人 + 移到评审列 |
| `add_checklist(cardId, item)` / `update_checklist(cardId, itemId, done)` | 清单 |
| `mark_blocked(cardId, reason)` / `unblock(cardId)` | 阻塞 |
| `append_memory(text)` | 追加角色长期记忆 |

**文件/执行工具(默认全开,Agent 可以做任何事)**
- `read` / `edit` / `write` / `bash`(pi 内置,经 `ExecutionEnv`);可选沙箱限制。
- 附加:`git_status` / `git_diff`(参照 pi-web),卡片 worktree 工具(M3)。

---

## 9. 调度器与事件总线

### 9.1 Orchestrator
- 订阅 EventBus 板事件(`card.created/moved/commented/assigned/blocked`,`stage.done`,`mention`)。
- 事件 → 生成 WakeSignal → 按来源优先级路由到角色空闲实例;无空闲实例则排队。
- 定时兜底扫描:漏事件、过期认领回收、策略重估、心跳检查。
- 实例监督:按 `instanceCount` 启停;异常退出指数退避重启;启动时接管失效认领。

### 9.2 @提及解析(统一管线)
- 写评论/描述时,服务器解析 `@name`:
  - `@角色名` → 挑一个空闲实例(轮询/最少队列)产生 mention WakeSignal;全忙则排队。
  - `@实例名` → 指定实例。
  - `@用户名` → 生成 Notification(SSE 推送),不产生认领。
- 活动时间线渲染 @ 为可点击;被 @ 的角色/用户有未读标记。

### 9.3 认领策略引擎
- assign/mention:直接入队,不走打分。
- claim:候选卡片按策略打分排序(优先级 × 权重 + 时效加成 + 技能匹配 + 实例负载均衡扰动);实例一次取一个。

---

## 10. 存储与持久化

| 数据 | 存储 | 位置 |
|---|---|---|
| 板/列/卡片/阶段/活动/唤醒/角色配置/用量 | SQLite | `<dir>/.kanban/board.db` |
| 用户/认证 | SQLite(全局) | `~/.pipipi/users.db` |
| 卡片会话(每卡片 transcript) | pi JSONL durable session | `<dir>/.kanban/sessions/` |
| memory.md / 角色资源 | 文件系统 | `<dir>/.kanban/roles/<id>/`(全局模板可选) |

事务保证原子认领与乐观锁;密码 bcrypt/argon2 hash。

---

## 11. 服务端 API 与 SSE

### 认证
- 简单认证:用户名 + 密码(session cookie);登录页。
- 首个管理员:环境变量 `PIPIPI_ADMIN_USER/PASSWORD` 或首次启动引导创建;**仅管理员可建号**。
- 可选整体 Basic Auth(`PIPIPI_PASSWORD`,pi-web 模式,供无登录/内网场景)。

### REST
- `POST /api/auth/login|logout`, `GET /api/me`, `GET/POST /api/users`(admin)
- `GET /api/board`(当前目录看板), `POST /api/board/cards`, `GET/PUT /api/cards/:id`
- `POST /api/cards/:id/claim|move|comment|block|assign|review|wake`(comment 自动解析 @)
- `GET/PUT /api/roles/:id`(含 agent.md/memory.md/skills 编辑)
- `GET /api/instances`, `POST /api/instances/:id/wake|abort`
- `POST /api/instances/:id/chat`(直聊,fork 会话), `GET /api/instances/:id/chat/:chatId/events`
- `GET /api/notifications`, `POST /api/notifications/:id/read`
- `GET /api/usage`

### SSE
- `GET /api/board/events`:板级事件(card.* / activity.* / instance.* / notification.*)
- `GET /api/instances/:id/events`:实例级事件(harness 事件:`message_update`、`tool_execution_*`、`turn_*`、`agent_end`…)
- `GET /api/instances/:id/chat/:chatId/events`:直聊事件流
- 断线重连:重连即拉快照,事件不重放(pi-web 模式)。

---

## 12. 前端

- **看板视图**:列 + 卡片(标题/优先级/标签/负责人/持有实例头像),拖拽移动;列头显示可认领角色。
- **卡片详情抽屉**:描述、清单、阶段进度(每阶段角色/状态)、**活动时间线**(用户与 Agent 混排,Agent 消息流式渲染,@ 可点击)、评论输入(带 @ 补全)、指派/唤醒/**验收(通过/驳回,可改验收人)** 操作。
- **Agent 面板**:按角色分组的实例卡片(状态/当前卡片/队列/用量),**直聊入口(fork 会话)**,唤醒(带消息)、中止、日志。
- **用户通知**:铃铛 + 未读标记(mention/review 请求);被 @ 实时提醒。
- **角色配置页**:编辑 agent.md/memory.md、技能、prompt 模板、模型/实例数/认领策略。
- **登录页 + 用户管理(admin)**。
- 渲染:markdown、代码高亮、mermaid、katex、图片(复用 pi-web 方案)。

---

## 13. 并发、一致性与故障恢复

- **原子认领**:SQLite 事务 `UPDATE card SET holder=?, status='in_progress', version=version+1 WHERE id=? AND holder IS NULL AND status='ready'`;受影响 0 行即失败。
- **乐观锁**:卡片字段更新带 `version`,冲突 409 → Agent 重读重试。
- **单写者会话**:卡片会话同一时刻仅一个实例写(认领保证);直聊 fork 分支与主分支互不影响。
- **幂等**:工具可重试;WakeSignal 带状态与去重(同一来源同一卡片同一角色只入队一次 pending)。
- **崩溃恢复**:重启 → 恢复板数据 → 过期认领回收(心跳 TTL)→ 实例监督重建实例 → 卡片会话由 harness 自动恢复。

---

## 14. 可观测性与成本

- 卡片活动时间线 = 审计日志;实例事件流 = 运行日志。
- 每 run token/cost 汇总(pi `Usage`),按角色/卡片/时段统计;**缓存命中(cacheRead/cacheWrite)单独统计,用于验证 §7.3 的缓存设计**。
- 错误与重试(`auto_retry`、工具错误、run 失败消息)进活动时间线。
- `GET /api/usage` + 简单面板。

---

## 15. 安全

- **用户认证**:密码 hash + session cookie;仅管理员建号。
- 可选整体 Basic Auth(`PIPIPI_PASSWORD`,pi-web 模式)。
- **权限**:管理员/普通用户;列与卡片操作权限按用户裁剪;Agent 工具按角色配置裁剪。
- **沙箱**:bash/文件工具默认全开,建议生产配工作目录隔离(容器/受限 shell),复用 pi sandbox 扩展。
- **密钥**:模型 API key 走环境变量/pi 凭据机制,不进库不进前端。
- 生产建议 HTTPS 或内网/受信网络。

---

## 16. 与 Pi 特性映射

| 需求 | Pi 对应实现 |
|---|---|
| 一次只干一件事 | `Agent.prompt()` 单 active run;`AgentHarness` busy phase |
| assign/mention/claim 驱动 | 看板原子认领 + `steer()`/`followUp()` 队列语义 + WakeSignal |
| agent.md | `DefaultResourceLoader` AGENTS.md 语义(角色目录版) |
| memory.md | 新增设计:contextFile + `append_memory` + summarization 压缩 |
| skills | `SKILL.md` 加载(agentskills.io 规范) |
| extensions | pi 扩展系统(`defineTool`) |
| prompts | prompt 模板 |
| 每卡片会话 | `AgentHarness` + JSONL session repository(认领时开/关) |
| 直聊 fork | `SessionRepository.fork()` / harness branch 能力 |
| 上下文压缩 | harness 内置 compaction |
| 文件/代码能力 | pi 内置 read/edit/write/bash 工具(ExecutionEnv) |
| 模型/供应商 | `createModels()` + 模型目录 |
| prompt 缓存 | pi-ai `cacheRetention` / cache_control |
| 实时 Web | pi-web 模式:SSE + 快照重连 |
| (未来)会话内多线程 | harness v2 lanes:每个卡片 = 一个 lane |

---

## 17. 技术选型与部署

- **框架**:Next.js(App Router),API routes + SSE + 静态托管一体(与 pi-web 同构)。
- **后端语言**:Node 22+ / TypeScript(仅 erasable TS,与 pi 仓库规范一致)。
- **Agent 运行时**:进程内 `AgentHarness`(认领时按卡片会话创建)+ `createModels()`。
- **存储**:SQLite(板/用户/用量)+ pi JSONL(卡片会话)。
- **前端**:React + Tailwind;markdown/katex/mermaid 复用 pi-web 方案。
- **仓库**:当前仓库即 pipipi(remote: `humoumou1215/pipipi.git`);**Pi 源码收纳至子目录 `pi/`**(整树 `git mv`,历史保留);pipipi 应用位于仓库根(详见 m1-spec §1)。
- **部署形态(参照 pi-web)**:
  - 独立 npm 包 `pipipi`,`bin: pipipi`,Next.js standalone 构建打包发布。
  - 启动:`pipipi --dir <path> -H 0.0.0.0 -p 3000`;`PIPIPI_PASSWORD` 整体认证。
  - 开发期:依赖本地构建的 pi 包(`npm run build` 后 `npm link` 或 file: 引用)。
  - 可配 systemd/容器运行,参考 pi-web containerization 文档。

---

## 18. 里程碑

- **M1(MVP)**:
  - 目录=看板(`--dir`/`PIPIPI_DIRS`)+ **Web 内切换目录(仅视图切换,各目录 Agent 后台持续运行)**;卡片/列 CRUD;用户认证(登录 + 管理员建号,**两级权限:管理员/普通用户**)。
  - **全局角色模板 `~/.pipipi/roles/` + 项目角色覆盖**。
  - 三种来源:assign(负责人流转)、mention(@解析 + 唤醒)、claim(定时扫描 + 列/优先级/时效打分)。
  - 单角色多实例;worker 循环 + 每卡片会话;看板工具 + read/edit/write/bash。
  - 前端:看板视图、卡片抽屉(活动时间线 + 评论 @ + 验收,驳回自动排队)、Agent 面板、通知铃铛;SSE 实时。
- **M2**:
  - 多角色阶段流转;memory.md 读写与压缩;**直聊(fork 源:卡片 / 实例 / 空白)**;**实例会话(scratchpad)**;角色配置页;用量统计(含缓存命中);错误重试可视化。
- **M3**:
  - skills/扩展/prompt 模板热加载;卡片 worktree 与 git 工具;沙箱加固;通知/权限细化;全局角色模板;多看板。
- **M4**:容器化部署、HTTPS、审计、规模优化。

---

## 19. 已确认决策

| 问题 | 决策 |
|---|---|
| 仓库形态 | **当前仓库即 pipipi**(remote 已指向 `humoumou1215/pipipi`);**Pi 源码收纳至 `pi/` 子目录**(整树 `git mv`,历史保留) |
| 多目录切换 | **仅前端视图切换**;各目录 Agent 实例**后台默认持续运行** |
| 验收驳回 | 回处理列并 @原处理角色;**忙/无实例自动排队** |
| 权限 | M1 **两级(管理员/普通用户)**;细粒度权限 M3 |
| 看板模型 | **一个目录 = 一个看板**;启动 `--dir` + **Web 内切换目录(M1)** |
| 全局角色模板 | **M1 支持**:`~/.pipipi/roles/` 全局模板 + 项目角色覆盖 |
| 后端框架 | **Next.js**(与 pi-web 同构) |
| 会话归属 | **每卡片一个会话**(接力共享;缓存分析见 §7.3) |
| Agent 能力 | **文件/bash 工具默认全开**,可做任何事 |
| 认领策略 | **assign(指派)/mention(@提及)/claim(自由认领)** 三来源;打分策略可配 |
| 验收人 | **默认 = 卡片创建者(用户),卡片详情可修改** |
| 直聊 | Agent 面板"与实例直接对话" = **fork 会话,不进入主流程(M2)**;**fork 源可选:卡片 / 实例 / 空白** |
| 缓存策略 | **每卡片会话 + 稳定 system prompt**;分层会话(实例会话=scratchpad, M2);缓存分析见 §7.3 |
| 用户模型 | **多用户 + 简单认证**;用户名/密码 hash + session;**仅管理员建号** |
| @提及 | 用户↔Agent 双向全支持;@用户=通知,@角色=唤醒 |
| 部署形态 | **参照 pi-web**:独立 npm 包、Next.js standalone、`-H/-p`、可选密码 |

## 20. 待定/开放问题

1. **Pi 源码收纳的执行时机**:将 `packages/`、`node_modules/`、根配置等整树 `git mv` 进 `pi/` 子目录(历史保留)。当前有活动 pi 会话与未提交改动——**建议先完成 M1 开发,收纳延后到 M1 代码稳定后统一执行**;或先收纳再开发,由你定。
