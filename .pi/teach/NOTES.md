# NOTES

## 教学工作区位置

当前 cwd 是 pi-mono git 仓库根。教学文件不放在仓库根(避免污染 git 状态),统一放在 `/media/pipipi/.pi/teach/`。`/media/pipipi/.pi/` 整体未跟踪,不会影响仓库。

## 用户偏好

- 中文授课,技术术语保留英文
- 每课约 15 分钟
- 从零开始:不熟悉 TypeScript 和 LLM API,先补最小阅读能力,再进仓库
- 目标:基于 pi 做拓展开发,构建自己的 agent(mission 选项 C)

## 待确认

- 自己的 agent 具体做什么?(影响第 7 课起项目课的选型)
- 扩展是"跑在 pi 内部的扩展",还是"用 pi-ai / pi-agent-core 库搭独立应用"?(影响课程侧重 coding-agent 扩展系统 vs agent 层 API)

## 课程路线草稿

1. 地形图:三层蛋糕 + 仓库寻宝(本课)
2. TypeScript 最小阅读集合(类型标注、union、泛型、async/await、工具类型)
3. LLM API 最小概念(completion、流式、tool calling、上下文窗口)
4. ai 层:统一接口、models、providers、如何加自定义 provider
5. agent 层:agent loop、工具调用、状态管理
6. 扩展系统:扩展点全景、生命周期、ctx、UI 能力
7. 造自己的 agent(项目课,多课)
