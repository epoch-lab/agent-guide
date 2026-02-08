---
outline: [2, 3]
---

# 架构设计

做 Agent 应用时，最容易踩坑的是“先把模型接起来，再补工程能力”。

推荐从系统分层开始设计，再落地具体能力。

## 推荐分层

```text
[Client/UI]
    |
[API Gateway]
    |
[Agent Orchestrator] -- [Policy & Guardrails]
    |                 \
    |                  -- [Observability]
    |
    +-- [Tool Adapters]
    +-- [Memory / RAG]
    +-- [Model Router]
```

## 架构设计原则

- 先定义状态机，再写提示词。
- 把不确定性留给模型，把确定性留给系统。
- 每个外部依赖都必须有降级路径。

## 最小可行架构清单

- 请求追踪：全链路 trace ID。
- 结果存档：输入、输出、工具调用记录可回放。
- 安全控制：高风险 Tool Call 需要显式确认。
- 回归评测：上线前固定回归数据集。
