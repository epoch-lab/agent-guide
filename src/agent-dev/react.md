---
outline: [2, 3]
---

# ReAct 模式

ReAct（Reasoning + Acting）是当前 Agent 系统中最主流的推理-行动范式。它的核心思想是：**让 LLM 交替进行"思考"和"行动"，直到完成任务**。

这个模式来自 2022 年的论文 [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)，已成为几乎所有主流 Agent 框架的基础架构。

## 直觉理解

想象你在解决一个问题：

> "北京今天适合户外跑步吗？"

你的思考过程大概是这样的：

1. **思考**：我需要知道北京今天的天气情况
2. **行动**：查询天气 API → 获取结果：晴，28°C，AQI 45
3. **思考**：天气不错，但我还需要确认是否有极端天气预警
4. **行动**：查询气象预警 → 无预警
5. **思考**：晴天，温度适中，空气质量优良，无预警，适合跑步
6. **输出**：适合户外跑步（附天气详情）

这就是 ReAct——**先想清楚要做什么（Reasoning），再去做（Acting），根据结果继续想，再继续做**。

## ReAct vs 直接调用 vs 纯推理

| 模式          | 做法                           | 问题                                 |
| ------------- | ------------------------------ | ------------------------------------ |
| 直接调用工具  | LLM 直接决定调用什么工具       | 没有推理过程，容易选错工具或遗漏步骤 |
| 纯推理（CoT） | LLM 只做推理，不调用工具       | 无法获取外部信息，容易产生幻觉       |
| **ReAct**     | 推理引导行动，行动结果反馈推理 | 兼顾推理质量和信息获取               |

## ReAct 循环详解

### 循环结构

```text
┌──────────────────────────────────────────┐
│                                          │
│  [用户输入]                               │
│      ↓                                   │
│  ┌─────────┐                             │
│  │ Thought │ — LLM 分析当前状态，决定下一步│
│  └────┬────┘                             │
│       ↓                                  │
│  ┌─────────┐                             │
│  │ Action  │ — 调用工具/API/函数          │
│  └────┬────┘                             │
│       ↓                                  │
│  ┌─────────────┐                         │
│  │ Observation  │ — 工具返回结果           │
│  └──────┬──────┘                         │
│         ↓                                │
│    任务完成？ ──否──→ 回到 Thought         │
│       ↓是                                │
│  ┌──────────────┐                        │
│  │ Final Answer │                        │
│  └──────────────┘                        │
│                                          │
└──────────────────────────────────────────┘
```

### 每一步的含义

- **Thought（思考）**：LLM 分析当前已有的信息，推理下一步应该做什么。这是 ReAct 和纯工具调用最大的区别——有显式的推理痕迹。
- **Action（行动）**：LLM 选择一个工具并生成调用参数。
- **Observation（观察）**：工具的执行结果，会被追加到对话上下文中，供下一轮 Thought 参考。

### 完整的 Prompt 示例

```text
你是一个能够使用工具的助手。你可以使用以下工具：

1. search(query: str) - 搜索互联网获取信息
2. calculator(expression: str) - 计算数学表达式
3. weather(city: str) - 查询城市天气

请按以下格式回答问题：

Thought: [分析当前情况，决定下一步]
Action: [工具名称(参数)]
Observation: [工具返回结果 — 由系统填入]
... (重复 Thought/Action/Observation)
Thought: [我现在有足够信息来回答了]
Final Answer: [最终答案]

用户问题：上海和北京今天的温差是多少度？
```

### 实际执行过程

```text
Thought: 用户想知道上海和北京的温差，我需要分别查询
         两个城市的天气。先查上海。

Action: weather("上海")

Observation: 上海今天晴，气温 32°C，湿度 65%

Thought: 已获取上海气温 32°C，接下来查询北京的天气。

Action: weather("北京")

Observation: 北京今天多云，气温 28°C，湿度 45%

Thought: 上海 32°C，北京 28°C，温差为 32 - 28 = 4°C。
         我有足够的信息来回答了。

Final Answer: 上海今天气温 32°C，北京 28°C，温差为 4°C。
              上海比北京高 4 度。
```

## 代码实现

### 基础 ReAct Agent

```python
import json
import re

class ReActAgent:
    """最小化的 ReAct Agent 实现"""

    def __init__(self, llm, tools: dict, max_steps: int = 10):
        self.llm = llm
        self.tools = tools          # {"tool_name": callable}
        self.max_steps = max_steps

    def _build_system_prompt(self):
        tool_desc = "\n".join([
            f"- {name}: {fn.__doc__}"
            for name, fn in self.tools.items()
        ])
        return f"""你是一个能使用工具的智能助手。

可用工具：
{tool_desc}

请严格使用以下 JSON 格式回复：

如果需要使用工具：
{{"thought": "你的思考过程", "action": "工具名", "action_input": "参数"}}

如果可以给出最终答案：
{{"thought": "你的思考过程", "final_answer": "最终回答"}}
"""

    def run(self, query: str) -> str:
        messages = [
            {"role": "system", "content": self._build_system_prompt()},
            {"role": "user", "content": query},
        ]

        for step in range(self.max_steps):
            # 1. 让 LLM 思考并决定行动
            response = self.llm.chat(messages)
            parsed = json.loads(response)

            print(f"\n--- Step {step + 1} ---")
            print(f"Thought: {parsed['thought']}")

            # 2. 检查是否已有最终答案
            if "final_answer" in parsed:
                print(f"Final Answer: {parsed['final_answer']}")
                return parsed["final_answer"]

            # 3. 执行工具调用
            tool_name = parsed["action"]
            tool_input = parsed["action_input"]
            print(f"Action: {tool_name}({tool_input})")

            if tool_name not in self.tools:
                observation = f"错误：工具 '{tool_name}' 不存在"
            else:
                try:
                    observation = self.tools[tool_name](tool_input)
                except Exception as e:
                    observation = f"工具执行失败：{str(e)}"

            print(f"Observation: {observation}")

            # 4. 将结果追加到上下文
            messages.append({"role": "assistant", "content": response})
            messages.append({"role": "user", "content": f"Observation: {observation}"})

        return "达到最大步数限制，未能完成任务"
```

### 使用示例

```python
def search(query: str) -> str:
    """在互联网上搜索信息"""
    # 实际实现会调用搜索 API
    return f"搜索 '{query}' 的结果: ..."

def calculator(expression: str) -> str:
    """计算数学表达式"""
    return str(eval(expression))

def get_weather(city: str) -> str:
    """查询指定城市的天气"""
    # 实际实现会调用天气 API
    return f"{city}: 晴，28°C"

agent = ReActAgent(
    llm=my_llm,
    tools={
        "search": search,
        "calculator": calculator,
        "weather": get_weather,
    },
    max_steps=10,
)

result = agent.run("杭州今天气温的华氏度是多少？")
```

执行过程大致如下：

```text
--- Step 1 ---
Thought: 用户想知道杭州气温的华氏度，我先查杭州天气获取摄氏温度
Action: weather(杭州)
Observation: 杭州: 晴，28°C

--- Step 2 ---
Thought: 杭州气温 28°C，需要转换为华氏度。公式：F = C × 9/5 + 32
Action: calculator(28 * 9 / 5 + 32)
Observation: 82.4

--- Step 3 ---
Thought: 杭州今天 28°C = 82.4°F，我可以回答了
Final Answer: 杭州今天气温 28°C，换算为华氏度约为 82.4°F。
```

## Function Calling：现代化的 ReAct

现代 LLM（如 GPT-4、Claude）内置了 **Function Calling / Tool Use** 能力，本质上就是将 ReAct 模式标准化了：

| ReAct 原始模式           | Function Calling                 |
| ------------------------ | -------------------------------- |
| Thought 在文本中         | 模型内部推理（有的模型也会输出） |
| Action 通过文本格式输出  | 通过结构化 JSON 输出             |
| 需要解析文本提取工具调用 | API 直接返回函数名和参数         |
| 格式容易出错             | 格式由 API 保证                  |

### Function Calling 示例

```python
# OpenAI 风格的 Function Calling
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "查询指定城市的当前天气",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "城市名称，如 '北京'"
                    }
                },
                "required": ["city"]
            }
        }
    }
]

# LLM 返回的不是文本，而是结构化的工具调用
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "北京天气怎么样？"}],
    tools=tools,
)

# response.choices[0].message.tool_calls 直接包含:
# [{"function": {"name": "get_weather", "arguments": '{"city": "北京"}'}}]
```

## ReAct 的常见问题与解决方案

### 1. 无限循环

**问题**：Agent 反复调用同一个工具，无法收敛。

**解决方案**：

```python
class SafeReActAgent(ReActAgent):
    def run(self, query):
        action_history = []

        for step in range(self.max_steps):
            # ... 获取 action ...

            # 检测重复行动
            action_key = f"{tool_name}:{tool_input}"
            if action_history.count(action_key) >= 2:
                # 强制要求换一种方式
                messages.append({
                    "role": "user",
                    "content": "你已经重复执行了相同的操作。请尝试不同的方法，或直接给出最终答案。"
                })
            action_history.append(action_key)
```

### 2. 工具选择错误

**问题**：Agent 选了不合适的工具或编造不存在的工具。

**解决方案**：

- 提供清晰的工具描述和使用示例
- 限制工具数量（建议单个 Agent 不超过 10-15 个工具）
- 对工具名做白名单校验

### 3. 上下文膨胀

**问题**：每次循环都会追加 Thought + Action + Observation，上下文快速增长。

**解决方案**：

```python
def compress_history(messages, keep_last_n=3):
    """压缩历史消息，保留关键信息"""
    if len(messages) <= keep_last_n * 3 + 2:  # system + user + n 轮
        return messages

    system = messages[0]
    user_query = messages[1]
    recent = messages[-(keep_last_n * 3):]

    # 将早期的交互压缩为摘要
    early = messages[2:-(keep_last_n * 3)]
    summary = llm.summarize(f"总结以下 Agent 的操作历史:\n{early}")

    return [system, user_query,
            {"role": "user", "content": f"之前的操作摘要：{summary}"},
            *recent]
```

### 4. 推理质量不稳定

**问题**：有时 Thought 写得很好，有时直接跳到 Action 没有充分推理。

**解决方案**：

- 在 System Prompt 中强调 Thought 的重要性
- 提供好的 few-shot 示例
- 使用支持 "思维链" 的模型（如具有 extended thinking 的模型）

## ReAct 的变体

### Plan-and-Execute

先制定完整计划，再逐步执行：

```text
Plan:
1. 查询北京天气
2. 查询上海天气
3. 计算温差
4. 生成回答

Execute Step 1: weather("北京") → 28°C
Execute Step 2: weather("上海") → 32°C
Execute Step 3: calculator("32-28") → 4
Execute Step 4: 生成最终回答
```

适合步骤明确的任务，减少中间推理开销。

### Reflexion

在 ReAct 基础上增加**自我反思**：

```text
Thought → Action → Observation → Reflection
                                     ↓
                          "我的方法对吗？结果可靠吗？"
                                     ↓
                              调整后续策略
```

适合需要高准确率的场景，以更多 LLM 调用换取更好的结果。

### Multi-Agent ReAct

多个 ReAct Agent 协作，各自负责不同领域的推理和行动，通过一个协调者汇总结果。

## 总结

- ReAct 的核心是 **Thought → Action → Observation** 的循环。
- 它让 Agent 具备了"先想后做"的能力，显著提升了推理质量。
- 现代 LLM 的 Function Calling 是 ReAct 模式的标准化和工程化。
- 实践中要注意控制循环次数、压缩上下文、处理异常情况。
- 大多数 Agent 框架（LangChain、LlamaIndex、AutoGen 等）的底层都基于 ReAct 或其变体。
