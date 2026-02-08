---
outline: [2, 3]
---

# Skill（技能）

## 什么是 Skill

**Skill**（技能）是 Agent 的**可复用能力单元**。它不是一段随意编写的提示词，而是一个具备明确目标、输入输出规范、执行约束和质量评估标准的**结构化能力模块**。

> 类比：如果 Agent 是一个员工，Skill 就是他的"岗位技能证书"——不仅说明他能做什么，还规定了做到什么程度才算合格、什么情况下应该拒绝执行。

## 为什么需要 Skill

### 没有 Skill 的 Agent

```
用户：帮我分析这个生产事故
Agent：（靠一段临时拼凑的 prompt 回复）
  - 可能遗漏关键信息
  - 输出格式不稳定
  - 无法评估质量
  - 不同开发者写出完全不同的 prompt
```

### 有 Skill 的 Agent

```
用户：帮我分析这个生产事故
Agent：（调用 analyze_incident Skill）
  ✓ 按标准结构收集 timeline、affected services、mitigation actions
  ✓ 输出固定包含 executive_summary + unresolved_questions + next_actions
  ✓ 有明确的质量评估标准
  ✓ 团队所有人使用同一套规范
```

## 核心概念

### 1. Skill 的结构定义

一个完整的 Skill 包含以下要素：

```yaml
name: analyze_incident
version: "2.1"
goal: 生成可供决策的生产事故分析报告

inputs:
  - name: timeline
    type: structured_text
    required: true
    description: 事故时间线，包含时间戳和事件描述

  - name: impacted_services
    type: list[string]
    required: true
    description: 受影响的服务列表

  - name: mitigation_actions
    type: list[string]
    required: false
    description: 已执行的缓解措施

constraints:
  - 禁止在没有证据的情况下推测根因
  - 未经明确授权不得访问外部数据源
  - 涉及客户数据时必须脱敏处理
  - 如果信息不足以给出结论，必须明确标注"信息不足"

output:
  format: markdown
  sections:
    - executive_summary # 高管摘要（3-5 句话）
    - impact_assessment # 影响范围评估
    - root_cause_analysis # 根因分析（附证据链）
    - unresolved_questions # 待解决问题清单
    - recommended_actions # 建议的后续行动

evaluation:
  - 摘要与时间线事实一致（可验证性）
  - 根因分析有日志/指标/事件支撑（证据性）
  - 建议行动可直接分配给具体团队（可执行性）
  - 输出格式严格符合模板（规范性）
```

### 2. Skill 的关键要素

| 要素            | 说明                     | 为什么重要             |
| --------------- | ------------------------ | ---------------------- |
| **Goal**        | 一句话描述技能的业务目标 | 防止功能蔓延，确保聚焦 |
| **Inputs**      | 带类型和约束的输入参数   | 确保调用者提供充足信息 |
| **Constraints** | 执行时的硬性限制规则     | 安全护栏，防止越界行为 |
| **Output**      | 结构化的输出格式定义     | 保证产出可预期、可消费 |
| **Evaluation**  | 可量化的质量衡量标准     | 支持回归测试和持续优化 |

### 3. Skill vs. Prompt

| 维度           | 普通 Prompt          | Skill                  |
| -------------- | -------------------- | ---------------------- |
| **复用性**     | 一次性使用，复制粘贴 | 版本化管理，跨项目复用 |
| **可测试性**   | 无法自动化评测       | 有评测标准，支持 CI/CD |
| **边界清晰度** | 模糊的自然语言描述   | 明确的输入/输出/约束   |
| **故障定位**   | 出了问题不知道改哪里 | 可以定位到具体要素     |
| **协作性**     | 每人写一套           | 团队共享统一标准       |

## 设计原则

### 原则一：一个 Skill 对应一个业务结果

```yaml
# ✅ 好的设计：聚焦单一目标
name: summarize_pr
goal: 为 Pull Request 生成结构化的代码审查摘要

# ❌ 坏的设计：混合多个目标
name: review_and_deploy_code
goal: 审查代码并决定是否部署到生产环境  # 两件事混在一起
```

**为什么**：当一个 Skill 尝试完成多个目标时，其评测标准变得模糊，调优的维度相互干扰，故障也更难定位。

### 原则二：明确定义失败行为

Skill 必须对异常情况有预案，而不是"看模型的表现"：

```yaml
failure_handling:
  missing_input:
    action: 列出缺失字段，请求补充
    response: "无法完成分析，缺少以下必要信息：{missing_fields}"

  conflicting_data:
    action: 标注冲突点，给出两种解读
    response: "检测到数据冲突：{conflicts}，以下是两种可能的解读..."

  out_of_scope:
    action: 明确拒绝并建议替代方案
    response: "此请求超出本 Skill 的能力范围。建议使用 {alternative_skill}"
```

### 原则三：预留评测钩子

每个 Skill 至少关联一个可量化的质量指标：

```yaml
evaluation_hooks:
  - metric: factual_accuracy
    method: 将输出事实与输入时间线逐条对照
    threshold: ">= 95%"

  - metric: actionability
    method: 检查每条建议是否包含责任人和截止时间
    threshold: "100% 建议可分配"

  - metric: format_compliance
    method: 自动校验输出是否包含所有必需 section
    threshold: "100% 通过"
```

## 实战示例：代码审查 Skill

```yaml
name: code_review
version: "1.3"
goal: 对 Pull Request 进行结构化代码审查

inputs:
  - name: diff
    type: text
    required: true
    description: PR 的代码变更 diff

  - name: context
    type: text
    required: false
    description: PR 描述和相关 issue 信息

  - name: language
    type: string
    required: true
    description: 主要编程语言

constraints:
  - 只关注变更的代码，不评审未修改的部分
  - 如果变更超过 500 行，先给出总览再逐模块分析
  - 区分"必须修复"和"建议改进"两个级别

output:
  sections:
    - summary: 变更概述（1-3 句话）
    - must_fix: 必须修复的问题列表
    - suggestions: 改进建议列表
    - security: 安全相关发现
    - test_coverage: 测试覆盖度评估

evaluation:
  - must_fix 中的每条都能指向具体代码行
  - 不包含与本次变更无关的通用建议
  - 安全问题 zero miss（可通过已知漏洞测试集验证）
```

## 常见反模式

| 反模式                        | 问题                           | 正确做法                 |
| ----------------------------- | ------------------------------ | ------------------------ |
| **在 Skill 中硬编码环境信息** | 密钥泄露，环境迁移困难         | 通过参数或环境变量注入   |
| **混合输出风格与执行逻辑**    | 改风格影响功能，改功能影响格式 | 将格式规范和业务逻辑分离 |
| **无版本管理**                | 行为变更无法追溯               | 语义化版本号 + 变更日志  |
| **缺少失败处理**              | 异常时行为不可预测             | 为每种异常定义确定性响应 |
| **目标过于宽泛**              | 无法有效评测和调优             | 拆分为多个聚焦的 Skill   |

## Skill 的组合与编排

复杂任务通常由多个 Skill 组合完成：

```
┌─────────────────────────────────────────────┐
│            incident_response 工作流          │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ collect  │→ │ analyze  │→ │ recommend │  │
│  │ _context │  │_incident │  │ _actions  │  │
│  └──────────┘  └──────────┘  └───────────┘  │
│     Skill 1      Skill 2      Skill 3      │
└─────────────────────────────────────────────┘
```

每个 Skill 独立可测、独立部署，通过标准化的输入输出接口串联。

## Skill 的核心作用

1. **能力标准化**：将隐性的 prompt 经验转化为显性的、可复用的能力资产。
2. **质量可控**：有明确的评测标准，支持持续集成中的自动化质量检查。
3. **协作效率**：团队使用同一套 Skill 定义，消除沟通歧义和重复劳动。
4. **可维护性**：结构化设计让 Skill 的迭代、调试和优化有据可依。

> **一句话总结**：Skill 是 Agent 能力的「标准化工序」——把知道怎么做变成确保做得好。

## Skill 评审清单

- 成功目标是否可量化？
- 约束条件是否可测试？
- 输出结构是否足够稳定，便于下游解析？
- 失败模式是否有文档说明？
