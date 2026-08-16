# pipipi — 看板 Agent 协作平台

用户与多角色 Agent 通过看板协作。Agent 按角色定义(agent.md / memory.md / skills / extensions / prompts),可写代码/执行任意文件操作;卡片经 **指派(assign)/@提及(mention)/自由认领(claim)** 三种来源驱动;一个 Agent 实例同时只处理一件事;同一角色可配置多个实例。

设计文档:`docs/design.md`(v0.4);M1 规格:`docs/m1-spec.md`。

## 快速开始

```bash
npm install --include=dev
npm run dev            # http://127.0.0.1:3099
```

### 部署(npm 包形态,参照 pi-web)

```bash
npm run build           # NODE_ENV=production 下构建
npm pack                # 产出 pipipi-<ver>.tgz
# 在目标机器安装并运行
npm install -g pipipi-<ver>.tgz
pipipi -H 0.0.0.0 -p 3000 --dir /path/to/board \
  --mock                # 无 API key 时用内置 mock provider
# 或注入真实 key
OPENCODE_API_KEY=<key> pipipi -H 0.0.0.0 -p 3000 --dir /path/to/board
```

容器化见 `docs/containerization.md`(含 Dockerfile)。

环境变量:

| 变量 | 说明 |
|---|---|
| `PIPIPI_DATA_DIR` | 全局数据(users.db / secret / 全局角色模板),默认 `~/.pipipi` |
| `PIPIPI_DIRS` | 启动时注册的看板目录(逗号分隔) |
| `PIPIPI_ADMIN_USER` / `PIPIPI_ADMIN_PASSWORD` | 首个管理员(或用 Web 引导创建) |
| `PIPIPI_PASSWORD` | 可选整体 Basic Auth |
| `PIPIPI_SCAN_INTERVAL_MS` | 认领扫描间隔,默认 30000 |
| `PIPIPI_MOCK_PROVIDER=1` | 启用内置 mock provider(无 API key 时验证 Agent 循环) |

使用流程:

1. 打开首页 → 首次运行创建管理员 → 登录
2. `+ board` 注册一个目录(该目录即一个看板,数据落 `<dir>/.kanban/`)
3. 角色目录(全局 `~/.pipipi/roles/<id>/` 或项目 `<dir>/.kanban/roles/<id>/`,项目优先):
   ```jsonc
   // role.json
   { "id": "dev", "name": "Developer", "model": "anthropic/claude-sonnet-4-5",
     "thinkingLevel": "off", "instanceCount": 1 }
   ```
   + `agent.md`(角色指令)+ `memory.md` + `skills/`(SKILL.md)
4. 建卡片(可指定 assigneeRole / 阶段 stages / 验收人)→ Agent 认领处理
5. 卡片评论 `@角色` / `@实例` / `@用户` → 唤醒 Agent / 通知用户

## 已验证(真实 API,2026-08-15)

- **真实模型跑通**:opencode-go 网关(deepseek-v4-flash,经 `~/.pi/agent/auth.json` 凭据 → `OPENCODE_API_KEY`)
- **真实任务闭环**:Agent 认领卡片 → `read_card` → `read`/`edit` 改 `calc.py` → `bash python3 test_calc.py` → 评论总结 → `complete_stage` → `request_review`;文件修复、测试通过、卡片到 review、验收人收到通知
- 认证/目录/角色/三来源/每卡片会话/SSE/mock 循环等 M1 冒烟测试均通过
- 真实测试修复的 bug:`complete_stage` 在 `stage_idx=-1` 时误将首阶段当下一阶段导致重复流转(已修,`nextRole:null` 单轮完成)

## 说明

- `next build` 需 `NODE_ENV=production`(Next 16 已知 bug:development 下 `/_global-error` 预渲染崩溃,见 vercel/next.js#97046)。
- 无 API key 时用 `PIPIPI_MOCK_PROVIDER=1` + 角色 model `mock/mock-model` 验证循环。
- 真实 key 可用 pi 的凭据:启动时 `OPENCODE_API_KEY=$(python3 -c "import json; print(json.load(open('$HOME/.pi/agent/auth.json'))['opencode-go']['key'])")`;角色 model 用 `opencode-go/deepseek-v4-flash`。
- 开发期 `npm run dev` 会与父目录 pi-mono 的 lockfile 混淆,`next.config.ts` 已固定 `turbopack.root`;生产启动用 `node node_modules/next/dist/bin/next start`(避免 npx 误装其他 next 版本)。

## 浏览器冒烟测试(scripts/browser-smoke.mjs)

零依赖 CDP 驱动 headless Chrome(机器上已有 playwright 缓存的 Chrome for Testing),验证登录→看板渲染→建卡→卡片抽屉+评论。

```bash
# 1. 启动服务(建议 mock provider)并预置:管理员、目录、角色、一张卡
# 2. 运行
node scripts/browser-smoke.mjs          # 截图输出到 /tmp/pp-*.png
```

浏览器实测发现并修复:`/api/dirs` 不再展示已被删除的目录(前端也只选 summary 非空的目录),避免选中已删除目录导致看板 500。
