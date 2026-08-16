# Pi Agent Harness 学习资源

## Knowledge

### 项目文档
- [Pi 官网 pi.dev](https://pi.dev)
  项目主站，包含演示和文档入口。用例：了解产品定位、功能概览。
- [Pi 官方文档](https://pi.dev/docs/latest)
  用户文档，涵盖快速开始、配置、Providers、模型等。用例：CLI 使用指南、配置说明。
- [packages/coding-agent/README.md](file:///media/pipipi/packages/coding-agent/README.md)
  coding-agent 包说明，包含安装和使用。用例：CLI 命令参考。
- [packages/coding-agent/docs/](file:///media/pipipi/packages/coding-agent/docs/)
  详细文档目录（quickstart、providers、models、skills、extensions、sdk 等）。用例：扩展开发、SDK 使用。
- [packages/agent/README.md](file:///media/pipipi/packages/agent/README.md)
  Agent 核心运行时说明。用例：理解 harness、harness-v2、工具系统。
- [packages/ai/README.md](file:///media/pipipi/packages/ai/README.md)
  多 Provider LLM API 层说明。用例：理解如何统一调用不同 LLM。
- [AGENTS.md](file:///media/pipipi/AGENTS.md)
  项目开发规范（人类和 AI Agent 共用）。用例：二次开发时遵循代码风格和流程。
- [CONTRIBUTING.md](file:///media/pipipi/CONTRIBUTING.md)
  贡献指南。用例：了解 issue/PR 流程。

### TypeScript / Node.js 基础（面向初学者）
- [TypeScript 官方手册](https://www.typescriptlang.org/docs/handbook/intro.html)
  官方 TS 入门。用例：补全类型系统、接口、泛型等基础概念。
- [MDN JavaScript 指南](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide)
  JS 基础（异步、Promise、模块等）。用例：理解 async/await、import/export。
- [Node.js 文档](https://nodejs.org/docs/latest/api/)
  Node.js 标准库。用例：理解 fs、path、child_process 等模块。

### Monorepo 与工程化
- [npm workspaces 文档](https://docs.npmjs.com/cli/using-npm/workspaces)
  Pi 使用的 monorepo 方案。用例：理解 `packages/*` 如何互相引用。
- [Biome 官网](https://biomejs.dev/)
  项目使用的 lint/format 工具（替代 ESLint + Prettier）。用例：理解 `npm run check`。
- [Vitest 文档](https://vitest.dev/)
  测试框架。用例：理解测试文件结构和运行方式。

### SDK 示例代码
- [packages/coding-agent/examples/sdk/](file:///media/pipipi/packages/coding-agent/examples/sdk/)
  12 个 SDK 示例，从最小化到完整控制。用例：学习如何用代码集成 Pi。
- [packages/coding-agent/examples/extensions/](file:///media/pipipi/packages/coding-agent/examples/extensions/)
  扩展示例（hello、todo、tools、snake 等）。用例：学习扩展开发模式。

## Wisdom (Communities)

- [Discord: Pi Community](https://discord.com/invite/3cU7Bz4UPx)
  官方 Discord。用例：提问、获取最新进展、与其他开发者交流。
- [GitHub Issues](https://github.com/earendil-works/pi-mono/issues)
  项目 issue 列表。用例：了解已知问题、设计讨论、功能需求。

## Gaps

- 目前缺少中文的架构深度解析资料
- 缺少从 0 到 1 编写扩展的视频教程
