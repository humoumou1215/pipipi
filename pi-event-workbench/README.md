# PI Event Workbench (MVP)

基于 PI Agent SDK 的本地单用户、规则驱动的多 Agent 群聊工作台。**Preset 是可配置成员，BusEvent 是可订阅消息，PI Session 是每次任务的独立上下文。** 不是修改原有 `pipipi` 看板；作为独立子项目运行。

## 已实现

- 单页 Web：群聊、Preset、Tools/Skills 来源分组开关、Prompt 追加指令、Trigger 编辑、Session 继续/停止。
- Preset：名称、头像、Provider、Model、Thinking、cwd、Tools、Skills、Prompt、规则和并发数。
- Bus：Web / Agent / GitHub / API 统一事件，SQLite 持久化和来源去重；SSE 实时更新。
- Triggers：来源 + 事件类型 + `mentions` / `content` / `payload.*`，支持 equals、contains、regex、exists；多条规则 OR，同一事件命中同一 Preset 去重。`@成员` 是结构化 mentions 条件，不依靠文本正则扫描所有来源。
- Agent：每次匹配新建 Session；手动“继续 Session”复用旧历史；Agent 的完成/失败事件重新进入总线；最大深度与 lineage 限制循环。
- GitHub Webhook：验证 HMAC-SHA256 签名；映射 `pull_request` 和 `issues` 类型，保留仓库、标题、PR URL 结构化字段。
- 显式 Mock 模式用于没有模型密钥的自动化验收，**默认不是 Mock**。

## 本机运行

需要 **Node.js 22.13+**。`node:sqlite` 在 Node 22 中仍为实验性接口。推荐 Node 24 LTS。

```bash
cd pi-event-workbench
npm install @earendil-works/pi-coding-agent
npm start                  # http://127.0.0.1:3098
```

正式模式必须提前配置 PI 的 Provider 凭据（PI 默认配置或 `~/.pi/agent/auth.json`）；服务健康检查会报告 SDK 未安装，**不会静默切换成 Mock**。

无模型凭据时先验证整个消息工作流：

```bash
node src/server.mjs --mock --port 3098
npm test
npm run check
```

数据默认写到 `./data/workbench.db`（包括 Preset、Event、Session 映射），PI 原生会话写到 `./data/pi-sessions`。可以用 `PIWB_DATA_DIR` 改存储位置。关闭浏览器不停止服务。

## GitHub 输入

配置环境变量 `PIWB_GITHUB_SECRET`，然后将 Webhook 指向：

```
POST http(s)://<host>:3098/api/github/webhook
Content-Type: application/json
X-GitHub-Event: pull_request
X-GitHub-Delivery: <UUID>
X-Hub-Signature-256: sha256=<hex>
```

Webhook 需要可由 GitHub 到达的 HTTPS 地址（如安全反向代理）。本地不可公网访问时，可通过外部程序轮询 GitHub，然后用 `POST /api/events` 发布，类型如 `github.pr.opened`，但 API 端点由客户端填写类型，不执行 GitHub 签名校验。

示例规则：来源 `github`，事件类型 `github.pr.opened`，字段 `payload.repository`，操作 `equals`，值 `humoumou1215/cfbc-docs`。注意：当前 Source Adapter 无自动轮询，Webhook 需要自行配置。

## 接口示例

```bash
# 创建 Preset，默认仅响应自身的 @ 提及
curl -X POST http://127.0.0.1:3098/api/presets \
  -H 'content-type: application/json' -d '{"name":"开发","tools":["read","grep","find","ls"]}'

# 群聊产生新的 Session
curl -X POST http://127.0.0.1:3098/api/messages \
  -H 'content-type: application/json' -d '{"content":"@开发 请分析代码"}'

# 外部 API 消息
curl -X POST http://127.0.0.1:3098/api/events \
  -H 'content-type: application/json' -d '{"eventType":"monitor.alert","content":"数据库连接异常","payload":{"severity":"high"}}'
```

`GET /api/presets`、`GET /api/events`、`GET /api/sessions`、`GET /api/resources`、`GET /api/health`，以及 `GET /api/stream` (SSE)。通过 UI 点击旧 Session 的“继续”发送定向消息，后端不会把它按 `@` 重新路由。

## 安全与当前边界

- 默认只监听 `127.0.0.1`；指定非本地 `--host` 时强制 `PIWB_TOKEN`。对外公开请使用 HTTPS、反向代理和安全网络策略。
- Webhook 必须提供 SHA-256 签名；外部 API 仅适合受信任的本机访问或配合 Token 的部署。Token 部署中访问 Web 前端需在请求中传递凭据，目前 UI 不提供 Token 登录界面，建议先使用本地模式。
- `tools` 控制 PI 模型可见工具集，**不等同于 OS 沙箱**。`bash`/`powershell` 可以执行写操作；如需真正只读，需要不启用 Shell 工具并通过操作系统/容器限制权限。已有不受信任 PI Extensions 仍可能扩大能力，生产请在隔离的 PI 配置目录中运行。
- GitHub PR 内容、Agent 消息和 API 输入都视为非可信外部数据，不会因文本包含 `@` 就被当作用户明确指令。
- MVP 没有 Preset 历史版本快照、多用户权限、Agent 专门协作协议；已有 Session 继续时按现有 Preset 配置恢复。
- UI 目前仅发现内置工具及常规目录中的 Skills；扩展/MCP 工具来源完整发现、实际 System Prompt 逐块显示、远程访问认证 UI、GitHub Polling、规则 regex 执行超时沙箱尚未实现。
- 实时流式文本展示在进行中的任务块内，最终提交的 Agent 消息作为持久化 Event 显示。

## 验收

执行 `npm test`：@ 提及精确匹配、正则/字段过滤、SQLite 重启持久化及去重、每次新建会话、定向继续、Agent 完成链式触发与防循环、GitHub 结构化事件、HTTP API 和 Webhook 拒签测试。

真正连接 Provider 后应额外进行 PI SDK 集成验收（至少：模型认证、Tools 列表、Skills 过滤、Session 重启恢复、工具执行权限验证）。当前构建环境无法联网安装 `@earendil-works/pi-coding-agent`，因此这些 **未声称已通过**。

技术参考：<https://pi.dev/docs/latest/sdk>、<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/preset.ts>。