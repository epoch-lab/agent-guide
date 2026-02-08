---
outline: [2, 3]
---

# Skill

`Skill` 是 Agent 的可复用能力单元。

一个可维护的 Skill 不应只有提示词，还要包含目标、边界和执行规范。

## 一个实用的 Skill 结构

```yaml
name: summarize_incident
goal: 生成可决策的事故摘要
inputs:
  - timeline
  - impacted_services
  - mitigation_actions
constraints:
  - 禁止编造根因
  - 未经请求不得外查数据
output:
  - executive_summary
  - unresolved_questions
  - suggested_next_actions
evaluation:
  - 与时间线事实一致
  - 建议具有可执行性
```

## 设计原则

### 1) 一项 Skill 对应一个业务结果

Skill 承担过多目标时，评测和调优都会显著变难。

### 2) 明确失败行为

对信息缺失、输入冲突、超出能力边界的请求给出处理规则。

### 3) 预留评测钩子

每个 Skill 至少关联一个可量化质量指标。

## 常见反模式

- 在 Skill 文本里硬编码环境密钥或私有地址。
- 把输出风格规则和工具执行策略混在一起。
- 修改 Skill 行为却不做版本管理。

## Skill 评审清单

- 成功目标是否可量化？
- 约束条件是否可测试？
- 输出结构是否足够稳定，便于下游解析？
- 失败模式是否有文档说明？
