# pipipi 开发规则

看板 Agent 协作平台:Next.js + pi 生态(`@earendil-works/pi-agent-core` / `pi-ai` / `pi-coding-agent`)。设计文档:`docs/design.md`;M1 规格:`docs/m1-spec.md`。

## 对话风格

- 回答简短直接,技术性表述
- commit/issue/PR/代码中不用 emoji、不用废话

## 目录约定

- `src/app/` — Next.js App Router(页面 + `/api/*` 路由)
- `src/server/` — 后端核心(非路由):`config` / `auth` / `db` / `events` / `agents` / `orchestration` / `dev`
- `src/lib/` + `src/components/` — 前端(hooks、类型、组件)
- `docs/` — 设计文档(design.md / m1-spec.md)
- `scripts/` — 冒烟脚本(browser-smoke.mjs)
- `pi/` — Pi 源码(vendored,历史保留)。**只读参考,永不修改**。应用依赖已发布的 `@earendil-works/pi-*`;调试 pi 本身用 `pi/` 下独立构建。

## 代码质量

- TypeScript strict;仅 erasable TS(无 `enum` / `namespace` / parameter properties)
- 无 `any`,除非绝对必要
- 外部 API 类型以 `node_modules` 实际导出为准,不猜(`pi-agent-core` 已发布版用 `parameters` 而非 `inputSchema`,`JsonlSessionRepo` 而非 `JsonlSessionRepository`)
- 顶层 import 为主;禁内联 `await import()` / 动态类型导入
- 路由内禁止直接 SQL;数据访问只经 `src/server/db/`(BoardDb / GlobalDb 的公开方法,写操作走 `withTx`)
- 板事件只经 `EventBus` 广播;任何写操作后广播 `card.updated` / `activity.created`(orchestrator 据此驱动认领/唤醒/@提及)
- 看板工具改动后必须 `npx tsc --noEmit` 通过

## 命令

- 类型检查:`npx tsc --noEmit`(根 tsconfig 已排除 `pi/`、`.next`)
- 生产构建:`NODE_ENV=production npx next build`(development 下触发 Next 16 已知 bug `/_global-error` 预渲染崩溃,见 vercel/next.js#97046)
- 生产启动:`node node_modules/next/dist/bin/next start -H <host> -p <port>`(不要用 `npx next start`——会误装其他 next 版本)
- 浏览器冒烟:先启动服务并预置数据(管理员/目录/角色/卡片),再 `node scripts/browser-smoke.mjs`

## 环境与本机事实

- 本机 shell 带 `NODE_ENV=production` → npm 会跳过 devDeps;安装用 `npm install --include=dev`
- 真实 API key:`OPENCODE_API_KEY=$(python3 -c "import json; print(json.load(open('$HOME/.pi/agent/auth.json'))['opencode-go']['key'])")`,角色 model 用 `opencode-go/deepseek-v4-flash`
- 无 key 验证 Agent 循环:`PIPIPI_MOCK_PROVIDER=1` + 角色 model `mock/mock-model`
- 全局数据在 `~/.pipipi/`(users.db / secret / 全局角色模板);看板数据在各目录 `.kanban/`(board.db + sessions/ + roles/)
- `node:sqlite` 可用(实验特性,有警告)

## Git

- 只暂存**本次会话改动的文件**,显式路径 `git add <path>`;禁 `git add -A` / `git add .`
- 用户未要求不提交;提交格式 `{feat,fix,docs}[(server|agents|web)]: 描述`
- 禁 `git reset --hard` / `git checkout .` / `git clean -fd` / `git stash`
- 本工作目录可能有多个 pi/pipipi 会话并行,不触碰他人未提交改动
- `pi/` 目录内容不作为 pipipi 常规改动提交(除非收纳类大迁移)

## 已知坑(修复过,别回退)

- `next build` 必须 `NODE_ENV=production`
- 已删除目录的注册记录:`/api/dirs` 过滤 `existsSync`;前端只选 `summary !== null` 的目录
- `complete_stage` 在 `stage_idx=-1`(阶段未开始)时视为完成第一个阶段,不得误判为"下一阶段"触发重复流转
- next.config 固定了 `turbopack.root`(避免与父级 lockfile 混淆)
