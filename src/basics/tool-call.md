---
outline: [2, 3]
---

# Tool Calling（工具调用）

## 什么是 Tool Calling

**Tool Calling**（工具调用）是大语言模型（LLM）与外部世界交互的核心机制。它允许模型在推理过程中，以结构化的方式请求执行外部函数或 API，从而突破纯文本生成的限制，实现「感知—决策—执行」的闭环。

简单来说：**模型负责「想」，工具负责「做」**。

> 类比：Tool Calling 之于 LLM，就像系统调用（syscall）之于用户态程序——程序本身无法直接操作硬件，必须通过内核提供的接口来完成 I/O、网络、文件等操作。

## 核心概念

### 1. 工具定义（Tool Definition）

工具定义是暴露给模型的"能力菜单"。每个工具通过 JSON Schema 描述其名称、用途、参数结构和返回值格式。模型根据这些定义来决定何时、如何调用工具。

```json
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "获取指定城市的当前天气信息",
    "parameters": {
      "type": "object",
      "properties": {
        "city": {
          "type": "string",
          "description": "城市名称，如 '北京'、'上海'"
        },
        "unit": {
          "type": "string",
          "enum": ["celsius", "fahrenheit"],
          "description": "温度单位，默认为 celsius"
        }
      },
      "required": ["city"]
    }
  }
}
```

关键要素：

| 要素          | 作用                           | 示例                         |
| ------------- | ------------------------------ | ---------------------------- |
| `name`        | 工具唯一标识，模型据此发起调用 | `get_weather`                |
| `description` | 模型理解工具用途的核心依据     | "获取指定城市的当前天气信息" |
| `parameters`  | 约束输入结构，确保类型安全     | JSON Schema 定义             |
| `required`    | 标识必填参数                   | `["city"]`                   |

### 2. 调用流程（Calling Flow）

Tool Calling 的完整生命周期分为 5 个阶段：

```
用户输入 → [1.规划] → [2.生成调用] → [3.执行] → [4.返回结果] → [5.最终回复]
```

**详细步骤：**

1. **规划（Plan）**：模型分析用户意图，判断是否需要调用工具，选择合适的工具。
2. **生成调用（Generate Call）**：模型输出结构化的调用请求（函数名 + 参数 JSON），**而非直接执行**。
3. **执行（Execute）**：运行时（Runtime）接收调用请求，校验参数后执行实际的 API/函数调用。
4. **返回结果（Return）**：执行结果以结构化格式回传给模型。
5. **整合回复（Synthesize）**：模型将工具返回的原始数据与上下文结合，生成面向用户的自然语言回复。

### 3. 并行调用与链式调用

现代 LLM 支持两种高级调用模式：

**并行调用（Parallel Tool Calls）**：模型一次请求中同时发起多个工具调用。

```json
// 用户："北京和上海今天天气怎么样？"
// 模型一次生成两个调用：
[
  {
    "id": "call_1",
    "function": { "name": "get_weather", "arguments": "{\"city\": \"北京\"}" }
  },
  {
    "id": "call_2",
    "function": { "name": "get_weather", "arguments": "{\"city\": \"上海\"}" }
  }
]
```

**链式调用（Chained Tool Calls）**：前一个工具的输出作为后一个工具的输入，形成多步推理链。

```
用户："帮我查一下苹果公司最新股价，然后换算成人民币"
  → 调用 get_stock_price("AAPL")    → 返回 $198.5
  → 调用 convert_currency("USD", "CNY", 198.5) → 返回 ¥1,435.2
  → 最终回复："苹果公司最新股价为 $198.5，约合人民币 ¥1,435.2"
```

## 完整示例：端到端的 Tool Calling

以下是一个使用 OpenAI API 的完整 Python 示例：

```python
import openai
import json

# 1. 定义工具
tools = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": "在内部知识库中搜索技术文档",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "top_k": {"type": "integer", "description": "返回结果数量", "default": 3}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_ticket",
            "description": "创建一个运维工单",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "priority": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                    "description": {"type": "string"}
                },
                "required": ["title", "priority"]
            }
        }
    }
]

# 2. 发送请求，让模型决定是否调用工具
response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "数据库连接超时了，帮我查一下处理方案并创建一个高优先级工单"}],
    tools=tools,
    tool_choice="auto"  # 让模型自行决定
)

# 3. 处理工具调用
message = response.choices[0].message
if message.tool_calls:
    for tool_call in message.tool_calls:
        fn_name = tool_call.function.name
        fn_args = json.loads(tool_call.function.arguments)

        # 执行实际函数（这里是模拟）
        if fn_name == "search_knowledge_base":
            result = {"docs": ["重启连接池", "检查最大连接数配置", "查看防火墙规则"]}
        elif fn_name == "create_ticket":
            result = {"ticket_id": "OPS-2026-0208", "status": "created"}

        # 4. 将结果回传给模型
        # ...后续让模型整合结果生成最终回复
```

## 安全与可靠性

### 读写分级

| 级别 | 类型     | 示例               | 安全要求              |
| ---- | -------- | ------------------ | --------------------- |
| L1   | 只读查询 | 查天气、搜索文档   | 日志记录即可          |
| L2   | 数据写入 | 创建工单、发送消息 | 需参数校验 + 确认机制 |
| L3   | 高危操作 | 删除数据、资金转账 | 强制人工确认 + 审计   |

### 失败处理策略

```yaml
tool: create_change_ticket
risk_level: high
confirmation: required # 执行前需人工确认
timeout_ms: 5000 # 超时 5 秒
retry: 1 # 最多重试 1 次
fallback: produce_manual_template # 兜底方案
idempotent: true # 幂等保证，重试安全
```

### 常见故障分类

| 故障类型     | 原因                           | 排查方法                       |
| ------------ | ------------------------------ | ------------------------------ |
| **规划失败** | 模型选错工具或不该调用时调用了 | 检查 prompt 和工具描述是否清晰 |
| **参数错误** | 生成的参数不符合 schema        | 增加 schema 校验，优化参数描述 |
| **执行失败** | 网络/鉴权/超时/下游异常        | 查看日志、trace ID、重试策略   |
| **结果误读** | 模型错误解读工具返回值         | 规范返回格式，加入字段说明     |

## Tool Calling 的核心作用

1. **能力扩展**：让模型从「只能说」变为「能说也能做」，连接真实世界的数据和系统。
2. **精度提升**：计算、查询等确定性任务交给专业工具，避免模型「幻觉」。
3. **安全边界**：通过 schema 校验和权限控制，约束模型的行为范围。
4. **可观测性**：每次调用都有结构化的输入输出记录，支持调试、审计和回放。

> **一句话总结**：Tool Calling 是 Agent 从「聊天机器人」进化为「智能执行体」的关键基础设施。
