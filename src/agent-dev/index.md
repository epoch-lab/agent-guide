---
outline: [2, 3]
---

# 应用开发

这一部分讨论如何把 Agent 从 Demo 推进到可上线系统。

## 三层开发视角

1. **体验层**：用户如何发起任务、查看结果、处理失败。
2. **编排层**：任务如何拆解、路由、并发和回滚。
3. **能力层**：模型、工具、知识库、记忆系统如何协作。

## 推荐阅读顺序

- [任务编排](/agent-dev/task-orchestration)
- [ReAct 模式](/agent-dev/react)
- [大模型缓存](/agent-dev/llm-cache)

## 本章节目标

- 掌握主流的 Agent 任务编排模式（Chain、DAG、Graph、Workflow 等）。
- 理解 ReAct 推理-行动循环及其工程实现。
- 学会运用多级缓存策略降低 LLM 调用成本和延迟。
