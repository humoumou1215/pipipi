# Mission: 基于 Pi Agent 框架的二次开发与定制

## Why
用户希望掌握 Pi Agent Harness 的架构和实现原理，以便在此基础上进行二次开发，构建自己的定制化 AI Agent 或扩展现有功能。通过系统学习，将能够独立阅读、理解和修改这个 TypeScript monorepo 的核心代码。

## Success looks like
- 能够描述 Pi 项目的整体架构和各包之间的依赖关系
- 能够独立搭建开发环境，运行构建、测试和 CLI
- 理解 Agent 核心循环（prompt → tool call → 结果）的实现机制
- 能够为 pi-coding-agent 添加自定义工具、扩展或技能
- 能够基于 pi-ai 包接入新的 LLM 提供商
- 掌握会话管理、记忆、压缩等高级特性的实现原理

## Constraints
- 用户是 TypeScript/Node.js 初学者，概念讲解需要从基础出发
- 采用循序渐进的学习节奏，每节课聚焦单一概念
- 学习过程中需要附带实践练习，确保真正理解
- 所有学习资料均围绕"二次开发"目标展开，无关内容跳过

## Out of scope
- 深入数学/算法原理（如 tokenizer 内部细节）
- 非核心基础设施的细节（如 CI/CD 配置细节）
- UI 样式定制（TUI 主题等）
- 社区运营、开源流程等非技术内容
