---
outline: [2, 3]
---

# Tool Call

`Tool Call` 是模型推理与真实世界副作用之间的桥梁。

与普通文本生成不同，Tool Call 会改变系统状态，因此可靠性和安全性是硬要求。

## 生命周期

1. **Plan**：模型按意图和策略选择工具。
2. **Validate**：运行时校验参数、权限和 schema。
3. **Execute**：按超时与重试策略执行外部调用。
4. **Observe**：记录结果、延迟和错误类型。
5. **Recover**：触发兜底流程或请求用户确认。

## 契约要求

- 参数 schema 稳定，且必须严格校验。
- 成功返回与错误返回都要结构化、可机读。
- 明确超时预算与幂等策略。

## 可靠性模式

- 读工具与写工具分级治理，采用不同安全门槛。
- 为每次调用附加 request ID，支持回放与根因分析。
- 在工具无响应时提供确定性的兜底输出。

## 调用策略示例

```yaml
tool: create_change_ticket
risk_level: high
confirmation: required
timeout_ms: 5000
retry: 1
fallback: produce_manual_ticket_template
```

## 失败分类

- **规划失败**：选错工具或调用时机。
- **校验失败**：参数结构不合法。
- **执行失败**：网络、超时、鉴权或依赖异常。
- **恢复失败**：没有可用降级路径。
