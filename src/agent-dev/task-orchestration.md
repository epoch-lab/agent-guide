---
outline: [2, 3]
---

# 任务编排

Agent 在接收到复杂任务后，需要将其拆解为一系列可执行步骤，并决定这些步骤之间的执行关系。这就是**任务编排**——它定义了"做什么、按什么顺序做、出错了怎么办"。

任务编排是 Agent 系统从"能用"到"可靠"的分水岭。

## 为什么需要任务编排

假设你让 Agent 完成一个需求：「帮我写一篇关于 Node.js 性能优化的技术博客，并发布到公司内网」。

这个任务至少包含：

1. 搜索 Node.js 性能优化的最佳实践
2. 组织大纲
3. 撰写正文
4. 审核内容质量
5. 格式转换
6. 调用发布 API

如果不做编排，Agent 可能会试图一次性完成所有事情，导致上下文爆炸、遗漏步骤、无法回退。任务编排就是把这些步骤显式化、可控化的机制。

## 编排模式概览

| 模式                   | 特点                                 | 适用场景            |
| ---------------------- | ------------------------------------ | ------------------- |
| Chain（链式）          | 步骤顺序执行，前一步输出是后一步输入 | 流水线式任务        |
| DAG（有向无环图）      | 步骤可并行，有依赖关系               | 多步骤且部分可并发  |
| Graph（状态图）        | 步骤可形成环路，支持条件跳转         | 需要迭代/重试的任务 |
| Workflow（工作流）     | 预定义的固定流程，人工+自动混合      | 业务流程自动化      |
| Hierarchical（层级式） | 主 Agent 分配任务给子 Agent          | 多角色、多能力协作  |

---

## Chain（链式编排）

### 核心思想

将任务拆解为**线性串联**的步骤，每一步的输出直接作为下一步的输入。

```text
[Step 1] → [Step 2] → [Step 3] → [Result]
```

### 典型场景

- 文本处理管道：原始文本 → 清洗 → 摘要 → 翻译
- 数据 ETL：提取 → 转换 → 加载

### 代码示例

用伪代码描述一个简单的 Chain：

```python
def chain_execute(input_data, steps):
    """
    链式执行：每一步的输出是下一步的输入
    """
    current = input_data
    for step in steps:
        current = step.run(current)
    return current

# 使用示例
steps = [
    ExtractStep(),      # 从网页提取正文
    SummarizeStep(),    # 用 LLM 生成摘要
    TranslateStep(),    # 翻译为中文
]
result = chain_execute(raw_html, steps)
```

### 优点与局限

- ✅ 逻辑清晰，调试简单，日志可追溯
- ✅ 每一步可以独立测试和替换
- ❌ 无法并行，总延迟 = 各步骤延迟之和
- ❌ 不支持条件分支，灵活性不足

---

## DAG（有向无环图编排）

### 核心思想

将任务拆解为**带依赖关系的步骤图**，没有依赖关系的步骤可以并行执行。

```text
        ┌──→ [B: 抓取数据] ──┐
[A: 解析需求]                    ├──→ [D: 生成报告]
        └──→ [C: 查询知识库] ──┘
```

步骤 B 和 C 都依赖 A 的输出，但 B 和 C 之间没有依赖，可以并行执行。D 必须等 B 和 C 都完成后才能开始。

### 典型场景

- 并行调用多个工具，汇总结果后做最终决策
- 多数据源同时获取，合并后生成报告

### 代码示例

```python
from concurrent.futures import ThreadPoolExecutor, as_completed

class DAGExecutor:
    def __init__(self):
        self.graph = {}       # node_id -> callable
        self.deps = {}        # node_id -> [依赖节点列表]
        self.results = {}

    def add_node(self, node_id, fn, dependencies=None):
        self.graph[node_id] = fn
        self.deps[node_id] = dependencies or []

    def execute(self, initial_input):
        """拓扑排序 + 并行执行"""
        in_degree = {n: len(self.deps[n]) for n in self.graph}
        ready = [n for n, d in in_degree.items() if d == 0]

        with ThreadPoolExecutor(max_workers=4) as pool:
            while ready:
                futures = {}
                for node_id in ready:
                    # 收集依赖节点的输出作为输入
                    dep_results = {d: self.results[d] for d in self.deps[node_id]}
                    input_data = dep_results if dep_results else initial_input
                    futures[pool.submit(self.graph[node_id], input_data)] = node_id

                ready = []
                for future in as_completed(futures):
                    node_id = futures[future]
                    self.results[node_id] = future.result()
                    # 更新后续节点的入度
                    for n, deps in self.deps.items():
                        if node_id in deps:
                            in_degree[n] -= 1
                            if in_degree[n] == 0:
                                ready.append(n)

        return self.results

# 使用示例
dag = DAGExecutor()
dag.add_node("parse",    parse_requirement)
dag.add_node("fetch",    fetch_data,         dependencies=["parse"])
dag.add_node("search",   search_knowledge,   dependencies=["parse"])
dag.add_node("report",   generate_report,    dependencies=["fetch", "search"])
result = dag.execute(user_request)
```

### 优点与局限

- ✅ 充分利用并行能力，减少总延迟
- ✅ 依赖关系显式可见
- ❌ 不支持循环（需要重试时不够灵活）
- ❌ 编排复杂度随节点数增长

---

## Graph（状态图编排）

### 核心思想

将任务建模为**带状态转移的图**，允许条件分支和循环。每个节点代表一个状态，边代表状态转移条件。这是 [LangGraph](https://github.com/langchain-ai/langgraph) 等框架的核心思想。

```text
[开始] → [生成草稿] → [质量检查] →（通过）→ [发布]
                          ↓（不通过）
                     [修改草稿] → [质量检查]（循环）
```

### 典型场景

- 需要迭代改进的内容生成任务
- 包含审批/确认环节的业务流程
- Agent 自我反思和纠错

### 代码示例

```python
class StateGraph:
    """简化的状态图执行器"""

    def __init__(self):
        self.nodes = {}           # state -> handler function
        self.edges = {}           # state -> [(condition, next_state), ...]
        self.state_data = {}      # 全局状态存储

    def add_node(self, state, handler):
        self.nodes[state] = handler

    def add_edge(self, from_state, to_state, condition=None):
        if from_state not in self.edges:
            self.edges[from_state] = []
        self.edges[from_state].append((condition, to_state))

    def run(self, initial_state, data, max_iterations=10):
        current = initial_state
        self.state_data = data
        iteration = 0

        while current != "END" and iteration < max_iterations:
            # 执行当前节点
            handler = self.nodes[current]
            self.state_data = handler(self.state_data)

            # 决定下一个状态
            for condition, next_state in self.edges.get(current, []):
                if condition is None or condition(self.state_data):
                    current = next_state
                    break

            iteration += 1

        return self.state_data

# ===== 使用示例：带自动修正的文章生成 =====

def generate_draft(data):
    data["draft"] = llm.generate(data["topic"])
    data["revision_count"] = data.get("revision_count", 0)
    return data

def quality_check(data):
    score = llm.evaluate(data["draft"])
    data["quality_score"] = score
    data["passed"] = score >= 0.8
    return data

def revise_draft(data):
    feedback = llm.critique(data["draft"])
    data["draft"] = llm.revise(data["draft"], feedback)
    data["revision_count"] += 1
    return data

def publish(data):
    api.publish(data["draft"])
    data["published"] = True
    return data

# 构建状态图
graph = StateGraph()
graph.add_node("generate", generate_draft)
graph.add_node("check",    quality_check)
graph.add_node("revise",   revise_draft)
graph.add_node("publish",  publish)

graph.add_edge("generate", "check")
graph.add_edge("check",    "publish", condition=lambda d: d["passed"])
graph.add_edge("check",    "revise",  condition=lambda d: not d["passed"])
graph.add_edge("revise",   "check")    # 循环回到质量检查
graph.add_edge("publish",  "END")

result = graph.run("generate", {"topic": "Agent 任务编排"})
```

### 优点与局限

- ✅ 表达力强，支持循环、分支、条件跳转
- ✅ 可建模复杂业务逻辑
- ✅ 天然支持重试和自我纠错
- ❌ 需要设置最大迭代次数，防止死循环
- ❌ 调试难度较高，状态转移路径不直观

---

## Workflow（工作流编排）

### 核心思想

预定义完整的任务流程，强调**人机协作**和**确定性**。每个节点的类型和行为在设计时就已经确定，运行时严格按流程执行。

与 Graph 不同，Workflow 通常不让 LLM 自行决定路由，而是由系统规则驱动流转。

```text
[用户提交] → [AI 处理] → [人工审核] → [AI 修改] → [自动发布]
                              ↓（驳回）
                         [通知用户]
```

### 典型场景

- 合同审批、内容审核等有合规要求的场景
- 需要人工介入（Human-in-the-Loop）的流程
- 面向非技术用户的"可视化搭建"系统

### 与其他模式的对比

| 特性      | Chain | DAG | Graph | Workflow       |
| --------- | ----- | --- | ----- | -------------- |
| 并行支持  | ❌    | ✅  | ✅    | ✅             |
| 循环/分支 | ❌    | ❌  | ✅    | ✅（预定义）   |
| 动态路由  | ❌    | ❌  | ✅    | ❌（规则驱动） |
| 人工介入  | ❌    | ❌  | 可选  | ✅（核心）     |
| 确定性    | 高    | 高  | 中    | 高             |

---

## Hierarchical（层级式编排）

### 核心思想

引入 **Supervisor（主控 Agent）** 来协调多个 **Sub-Agent（子 Agent）**。主控 Agent 负责任务分解和结果汇总，子 Agent 各自具备特定能力。

```text
           [Supervisor Agent]
          /        |         \
[Research Agent] [Code Agent] [Review Agent]
```

### 典型场景

- 软件开发流程：需求分析 Agent + 编码 Agent + 测试 Agent
- 数据分析：数据获取 Agent + 可视化 Agent + 报告 Agent
- 多模态任务：文本 Agent + 图片 Agent + 语音 Agent

### 代码示例

```python
class SupervisorAgent:
    """主控 Agent：负责任务分解和子 Agent 调度"""

    def __init__(self, sub_agents: dict):
        self.sub_agents = sub_agents
        self.llm = LLM()

    def execute(self, task: str):
        # 1. 用 LLM 分解任务
        plan = self.llm.generate(f"""
        将以下任务分解为子任务，并为每个子任务指定执行者。
        可用的执行者: {list(self.sub_agents.keys())}

        任务: {task}

        输出 JSON 格式:
        [
            {{"agent": "agent_name", "sub_task": "具体任务描述", "depends_on": []}},
            ...
        ]
        """)

        sub_tasks = json.loads(plan)
        results = {}

        # 2. 按依赖顺序执行子任务
        for st in topological_sort(sub_tasks):
            agent = self.sub_agents[st["agent"]]
            context = {dep: results[dep] for dep in st["depends_on"]}
            results[st["sub_task"]] = agent.run(st["sub_task"], context)

        # 3. 汇总结果
        summary = self.llm.generate(f"根据以下子任务结果，生成最终报告:\n{results}")
        return summary

# 使用示例
supervisor = SupervisorAgent({
    "researcher": ResearchAgent(),
    "coder":      CodeAgent(),
    "reviewer":   ReviewAgent(),
})
result = supervisor.execute("为公司内部工具添加用户权限管理功能")
```

### 优点与局限

- ✅ 分工明确，每个子 Agent 可以独立优化
- ✅ 可扩展性好，增加新能力只需增加子 Agent
- ✅ 主控 Agent 可以根据任务动态选择子 Agent
- ❌ 通信开销大，上下文在 Agent 间传递会损失信息
- ❌ 需要主控 Agent 有足够的任务分解能力

---

## 编排模式选择决策树

```text
你的任务需要循环/迭代吗？
├── 是 → Graph / 状态图
│        └── 需要人工审批吗？→ 是 → Workflow
└── 否 → 步骤间有并行空间吗？
         ├── 是 → DAG
         └── 否 → 是否涉及多角色/多能力？
                  ├── 是 → Hierarchical
                  └── 否 → Chain（最简方案）
```

## 工程实践建议

### 1. 从 Chain 开始，逐步升级

不要一开始就上 Graph。先用 Chain 跑通主流程，再根据实际瓶颈选择更复杂的模式。

### 2. 每一步都要可观测

```python
import logging
import time

def traced_step(step_name, fn, input_data):
    """为每个步骤添加追踪"""
    start = time.time()
    logging.info(f"[{step_name}] 开始执行，输入大小: {len(str(input_data))}")

    try:
        result = fn(input_data)
        elapsed = time.time() - start
        logging.info(f"[{step_name}] 完成，耗时: {elapsed:.2f}s")
        return result
    except Exception as e:
        elapsed = time.time() - start
        logging.error(f"[{step_name}] 失败，耗时: {elapsed:.2f}s，错误: {e}")
        raise
```

### 3. 定义明确的失败策略

| 失败类型           | 建议策略                      |
| ------------------ | ----------------------------- |
| 工具调用超时       | 重试 2 次，然后降级到备选方案 |
| LLM 输出格式错误   | 重新生成，附加格式示例        |
| 中间步骤结果质量差 | 回退到上一步并调整 prompt     |
| 依赖服务不可用     | 使用缓存数据或跳过该步骤      |

### 4. 控制最大步数和最大耗时

```python
MAX_STEPS = 20
MAX_DURATION_SECONDS = 300

def safe_execute(graph, initial_state, data):
    start = time.time()
    steps = 0

    while not graph.is_finished():
        if steps >= MAX_STEPS:
            raise RuntimeError(f"超过最大步数限制: {MAX_STEPS}")
        if time.time() - start > MAX_DURATION_SECONDS:
            raise RuntimeError(f"超过最大执行时间: {MAX_DURATION_SECONDS}s")

        graph.step()
        steps += 1

    return graph.get_result()
```

## 总结

- **Chain** 是最简单的起点，适合线性流水线。
- **DAG** 引入并行能力，减少等待时间。
- **Graph** 支持循环和条件分支，适合需要迭代的场景。
- **Workflow** 强调人机协作和流程确定性。
- **Hierarchical** 适合多角色分工的复杂系统。

选择哪种模式取决于任务的复杂度、是否需要人工介入、以及是否需要迭代。好的编排设计应该是**可观测、可回退、有上限**的。
