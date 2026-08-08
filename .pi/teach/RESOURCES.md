# pi-mono 拓展开发学习资源

## Knowledge

- [pi 官方文档(pi.dev/docs/latest)](https://pi.dev/docs/latest)
  产品层文档:CLI、配置、扩展。用于:理解 pi 的使用方式与扩展机制。
- [in-repo: packages/coding-agent/docs/extensions.md](../../packages/coding-agent/docs/extensions.md)
  扩展开发权威文档(源码内)。用于:每个扩展点、生命周期、ctx API 的细节核对。
- [in-repo: packages/coding-agent/examples/extensions/README.md](../../packages/coding-agent/examples/extensions/README.md)
  扩展能力的完整菜单(工具、命令、UI、生命周期钩子)。用于:看扩展能做什么,找模仿对象。
- [in-repo: packages/agent/src/agent-loop.ts](../../packages/agent/src/agent-loop.ts)
  agent 循环核心实现。用于:理解 agent 如何与 LLM 交互、工具调用如何闭环。
- [in-repo: packages/ai/src/providers/](../../packages/ai/src/providers/)
  所有 LLM 提供商实现(anthropic.ts、openai.ts、google.ts…)。用于:自定义 provider 的参考模板。
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
  官方教程。用于:补 TypeScript 阅读能力(第 2 课)。
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference) / [Anthropic Docs](https://docs.anthropic.com/)
  LLM API 概念(chat completions、流式、tool calling)的一手来源。用于:第 3 课概念核对。

## Wisdom (Communities)

- [pi Discord](https://discord.com/invite/3cU7Bz4UPx)
  官方社区,维护者活跃。用于:扩展开发答疑、看真实用法。
- GitHub Issues / Discussions(earendil-works/pi-mono)
  用于:查已知问题、设计讨论、其他人踩过的坑。

## Gaps

- 中文的 pi 拓展开发教程几乎没有;参考文档与笔记是我们自己沉淀的。
- pi 扩展系统的正式文档在仓库 docs 中,pi.dev 上可能滞后 —— 以 in-repo 文档为准。
