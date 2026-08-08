# Mission: 基于 pi-mono 做拓展开发,构建自己的 agent

## Why

用户要以 pi(pi-mono 仓库)为底座做拓展开发,构建自己的 agent。当前从零起步:不熟悉 TypeScript,也不熟悉 LLM API。学习目标是吃透仓库的精髓与细节,最终能动手写出可运行的扩展与自己的 agent。

## Success looks like

- 能流畅阅读 pi 源码(ai / agent / coding-agent 三层),用自己的话解释关键机制(agent loop、工具调用、流式响应、扩展系统)
- 能独立写出一个 pi 扩展(自定义工具 / 命令 / 提供商),并用 `--extension` 参数或扩展目录把它跑起来
- 能基于 pi 的能力构建出自己的 agent,并知道去哪里查文档、问社区
- 清楚每层的边界,不把扩展逻辑写错层(例如不把提供商细节写进产品层)

## Constraints

- 每课 15 分钟:短课、快反馈、一课一个可带走的小胜利
- 从零开始:先补最少的 TypeScript 阅读能力与 LLM API 概念,再进仓库
- 中文授课,技术术语保留英文
- 不熟悉 LLM API:概念课优先用 pi 自己的代码与官方文档做一手来源

## Out of scope

- 深入 TUI 差分渲染、protocol/client/server RPC、storage 细节(除非拓展开发需要)
- 向 pi 核心贡献代码、过 contributor gate
- LLM 训练 / 微调 / 提示工程深水区
