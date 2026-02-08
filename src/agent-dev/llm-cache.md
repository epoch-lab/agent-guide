---
outline: [2, 3]
---

# 大模型缓存

每次调用大模型都要花钱、花时间。如果同样的问题或相似的上下文被反复请求，不做缓存就是在烧钱。

**大模型缓存**的目标是：**在不损失（或可接受地损失）回答质量的前提下，减少重复的 LLM 调用，降低延迟和成本。**

## 为什么大模型缓存很重要

来看一组典型数据：

| 指标                   | 无缓存                 | 有缓存                   |
| ---------------------- | ---------------------- | ------------------------ |
| 平均响应时间           | 2-10 秒                | 5-50 毫秒（命中时）      |
| 单次调用成本（GPT-4）  | $0.03-0.12             | $0（命中时）             |
| 每日 10 万次调用月成本 | $9,000-$36,000         | 大幅降低（取决于命中率） |
| 并发瓶颈               | 受 API rate limit 限制 | 命中缓存时无限制         |

Agent 系统中缓存尤为重要，因为：

- 一个任务可能触发 5-20 次 LLM 调用（ReAct 循环）
- 很多子步骤的输入高度相似（如格式化、分类）
- 用户的高频问题存在大量重复

## 缓存层次总览

```text
┌─────────────────────────────────────────────────┐
│                  应用层缓存                        │
│   完全相同的 prompt → 直接返回缓存结果               │
├─────────────────────────────────────────────────┤
│                  语义缓存                          │
│   语义相似的 prompt → 返回已有的相似回答              │
├─────────────────────────────────────────────────┤
│              Prompt 缓存（前缀缓存）                │
│   相同前缀的 prompt → 复用已计算的 KV Cache         │
├─────────────────────────────────────────────────┤
│              KV Cache（推理层）                    │
│   模型推理过程中的 Key-Value 缓存                   │
└─────────────────────────────────────────────────┘
```

下面逐一深入讲解。

---

## 1. 精确缓存（Exact Cache）

### 原理

最直观的缓存策略：**如果输入完全一样，就直接返回之前的输出**。

```text
输入 hash → 查缓存 → 命中？→ 返回缓存结果
                        ↓否
                   调用 LLM → 存入缓存 → 返回结果
```

### 代码实现

```python
import hashlib
import json
import time

class ExactCache:
    """精确匹配的 LLM 缓存"""

    def __init__(self, ttl_seconds=3600):
        self.cache = {}
        self.ttl = ttl_seconds
        self.stats = {"hits": 0, "misses": 0}

    def _make_key(self, messages, model, temperature):
        """根据完整请求参数生成缓存键"""
        content = json.dumps({
            "messages": messages,
            "model": model,
            "temperature": temperature,
        }, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(content.encode()).hexdigest()

    def get(self, messages, model, temperature):
        key = self._make_key(messages, model, temperature)
        if key in self.cache:
            entry = self.cache[key]
            if time.time() - entry["timestamp"] < self.ttl:
                self.stats["hits"] += 1
                return entry["response"]
            else:
                del self.cache[key]  # 过期清除
        self.stats["misses"] += 1
        return None

    def set(self, messages, model, temperature, response):
        key = self._make_key(messages, model, temperature)
        self.cache[key] = {
            "response": response,
            "timestamp": time.time(),
        }

    @property
    def hit_rate(self):
        total = self.stats["hits"] + self.stats["misses"]
        return self.stats["hits"] / total if total > 0 else 0

# 使用示例
cache = ExactCache(ttl_seconds=7200)

def cached_llm_call(messages, model="gpt-4", temperature=0):
    # 先查缓存
    cached = cache.get(messages, model, temperature)
    if cached:
        return cached  # 命中缓存，直接返回

    # 未命中，调用 LLM
    response = openai.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
    )
    result = response.choices[0].message.content

    # 存入缓存
    cache.set(messages, model, temperature, result)
    return result
```

### 适用场景

- `temperature=0` 的确定性请求
- 分类、提取等结构化任务（输入固定，输出固定）
- 高频重复的用户问题

### 局限性

- 输入有任何微小差异就无法命中（多一个空格都不行）
- 对话类任务命中率很低（上下文总是在变）
- `temperature > 0` 时缓存可能不合适（期望多样性）

---

## 2. 语义缓存（Semantic Cache）

### 原理

精确缓存的致命缺陷是：**"北京今天天气怎么样"和"今天北京天气如何"对它来说是两个完全不同的请求**。

语义缓存通过 **Embedding 向量相似度** 来判断两个请求是否"意思一样"：

```text
用户输入 → 生成 Embedding → 在向量库中搜索相似的历史请求
    ↓
相似度 > 阈值？→ 返回历史回答
    ↓ 否
调用 LLM → 存储 (Embedding, 回答) → 返回结果
```

### 代码实现

```python
import numpy as np

class SemanticCache:
    """基于语义相似度的 LLM 缓存"""

    def __init__(self, embedding_model, similarity_threshold=0.95):
        self.embedding_model = embedding_model
        self.threshold = similarity_threshold
        self.entries = []  # [(embedding, query, response, timestamp)]
        self.stats = {"hits": 0, "misses": 0}

    def _get_embedding(self, text: str) -> np.ndarray:
        """将文本转为向量"""
        return self.embedding_model.encode(text)

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    def get(self, query: str):
        query_embedding = self._get_embedding(query)

        best_match = None
        best_score = -1

        for embedding, cached_query, response, ts in self.entries:
            score = self._cosine_similarity(query_embedding, embedding)
            if score > best_score:
                best_score = score
                best_match = (cached_query, response)

        if best_score >= self.threshold:
            self.stats["hits"] += 1
            return best_match[1]  # 返回缓存的回答

        self.stats["misses"] += 1
        return None

    def set(self, query: str, response: str):
        embedding = self._get_embedding(query)
        self.entries.append((embedding, query, response, time.time()))

# 使用示例
semantic_cache = SemanticCache(
    embedding_model=SentenceTransformer("all-MiniLM-L6-v2"),
    similarity_threshold=0.92,
)

def smart_llm_call(query: str):
    # 语义缓存查找
    cached = semantic_cache.get(query)
    if cached:
        return cached

    response = llm.generate(query)
    semantic_cache.set(query, response)
    return response

# 以下两个请求会命中同一个缓存
smart_llm_call("Python 怎么读取 JSON 文件？")
smart_llm_call("如何用 Python 读取 JSON 文件")  # 语义相似，命中缓存
```

### 阈值选择指南

| 阈值范围  | 效果                         | 适用场景               |
| --------- | ---------------------------- | ---------------------- |
| 0.98-1.0  | 几乎等价于精确匹配           | 高精度要求             |
| 0.93-0.97 | 平衡命中率和准确性           | 通用推荐值             |
| 0.85-0.92 | 高命中率但可能返回不准确结果 | 对回答精度不敏感的场景 |
| < 0.85    | 不推荐                       | 容易返回错误结果       |

### 注意事项

- Embedding 计算本身也有成本（虽然远低于 LLM）
- 向量检索在数据量大时需要使用 ANN 索引（如 FAISS、Milvus）
- 语义相似不等于答案相同——"今天北京天气"和"明天北京天气"语义很近但答案不同

---

## 3. Prompt 缓存 / 前缀缓存（Prefix Caching）

### 原理

这是**模型提供商层面**的缓存优化，不需要开发者自己实现。

核心思想：**多个请求如果共享相同的 prompt 前缀（如 System Prompt），可以复用已计算的 KV Cache，只需增量计算新增部分**。

```text
请求 A: [System Prompt (2000 tokens)] + [用户消息 A (100 tokens)]
请求 B: [System Prompt (2000 tokens)] + [用户消息 B (150 tokens)]

没有前缀缓存：每次都要计算 2000 + N tokens
有前缀缓存：  System Prompt 的 KV Cache 被复用，只需计算 N tokens
```

### 各厂商支持情况

| 提供商    | 功能名称        | 自动/手动 | 价格优惠                |
| --------- | --------------- | --------- | ----------------------- |
| OpenAI    | Prompt Caching  | 自动      | 缓存输入 token 降价 50% |
| Anthropic | Prompt Caching  | 手动标记  | 缓存读取降价 90%        |
| Google    | Context Caching | 手动创建  | 缓存 token 降价 75%     |
| DeepSeek  | Context Caching | 自动      | 缓存命中降价约 90%      |

### Anthropic 示例

Anthropic 需要显式标记哪些内容要缓存：

```python
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": "你是一个专业的代码审查助手。以下是项目的编码规范文档...(很长的文档内容)...",
            "cache_control": {"type": "ephemeral"}  # 标记这部分需要缓存
        }
    ],
    messages=[
        {"role": "user", "content": "请审查这段代码: def foo(): pass"}
    ],
)

# 查看缓存效果
print(f"输入 tokens: {response.usage.input_tokens}")
print(f"缓存创建 tokens: {response.usage.cache_creation_input_tokens}")
print(f"缓存读取 tokens: {response.usage.cache_read_input_tokens}")
```

### 最佳实践

```python
# ❌ 不利于前缀缓存的写法
# 每次请求的 system prompt 都不同（带了时间戳）
messages = [
    {"role": "system", "content": f"当前时间: {datetime.now()}。你是一个助手..."},
    {"role": "user", "content": user_query},
]

# ✅ 有利于前缀缓存的写法
# system prompt 固定，变化的信息放到 user message 中
messages = [
    {"role": "system", "content": "你是一个助手。请根据用户提供的信息回答问题。"},
    {"role": "user", "content": f"当前时间: {datetime.now()}\n\n{user_query}"},
]
```

**关键原则**：

- 把**不变的内容（规则、文档、示例）放在前面**
- 把**变化的内容（用户输入、动态数据）放在后面**
- 前缀越长、复用率越高，节省就越多

---

## 4. KV Cache（推理层缓存）

### 原理

这是 Transformer 模型推理过程中的底层缓存机制，通常对应用开发者透明，但理解它有助于做出更好的工程决策。

在 Transformer 的自注意力机制中，每个 token 需要与之前所有 token 做注意力计算。**KV Cache 的作用是把已经计算过的 Key 和 Value 存起来，避免重复计算**。

```text
没有 KV Cache：
生成第 N 个 token 时，需要重新计算前 N-1 个 token 的 K 和 V
时间复杂度: O(N²)

有 KV Cache：
生成第 N 个 token 时，直接使用缓存的 K 和 V，只计算第 N 个 token 的
时间复杂度: O(N)（生成每个 token 时）
```

### 示意图解

```text
输入: "今天天气真好"

第 1 步: 处理 "今" → 计算 K₁,V₁ → 缓存 [K₁,V₁]
第 2 步: 处理 "天" → 计算 K₂,V₂ → 用缓存 [K₁,V₁] + 新的 [K₂,V₂]
第 3 步: 处理 "天" → 计算 K₃,V₃ → 用缓存 [K₁,V₁,K₂,V₂] + 新的 [K₃,V₃]
...

生成阶段:
第 6 步: 生成 "，" → 用缓存 [K₁..K₅, V₁..V₅] → 只算注意力，不重算 KV
第 7 步: 生成 "适" → 用缓存 [K₁..K₆, V₁..V₆] → 继续追加
```

### 内存占用

KV Cache 的内存需求与**序列长度成正比**，这也是为什么长上下文会消耗大量显存：

```text
KV Cache 大小 ≈ 2 × 层数 × 头数 × 头维度 × 序列长度 × 精度字节数

以 Llama-70B 为例 (80层, 64头, 128维, FP16):
4K 上下文:  约 2.5 GB
32K 上下文: 约 20 GB
128K 上下文: 约 80 GB
```

### 与应用开发的关系

虽然 KV Cache 是底层机制，但它影响应用层的几个决策：

1. **上下文长度控制**：更长的上下文 = 更多的 KV Cache = 更高的成本和延迟
2. **批处理效率**：共享相同前缀的请求可以共享 KV Cache（这就是 Prefix Caching 的基础）
3. **流式输出**：KV Cache 是流式生成（streaming）能高效工作的关键

---

## 5. 多级缓存架构

在生产系统中，通常需要组合多种缓存策略：

```python
class MultiLevelCache:
    """多级缓存：精确缓存 → 语义缓存 → LLM 调用"""

    def __init__(self, embedding_model, redis_client=None):
        self.exact_cache = ExactCache(ttl_seconds=7200)
        self.semantic_cache = SemanticCache(
            embedding_model=embedding_model,
            similarity_threshold=0.95,
        )
        self.redis = redis_client  # 可选：持久化缓存

    def query(self, messages, model="gpt-4", temperature=0):
        user_query = messages[-1]["content"]

        # Level 1: 精确缓存（速度最快，微秒级）
        exact_result = self.exact_cache.get(messages, model, temperature)
        if exact_result:
            return {"result": exact_result, "cache_level": "exact"}

        # Level 2: 语义缓存（毫秒级）
        if temperature == 0:  # 只对确定性请求使用语义缓存
            semantic_result = self.semantic_cache.get(user_query)
            if semantic_result:
                return {"result": semantic_result, "cache_level": "semantic"}

        # Level 3: 调用 LLM（秒级）
        response = call_llm(messages, model, temperature)

        # 回填缓存
        self.exact_cache.set(messages, model, temperature, response)
        if temperature == 0:
            self.semantic_cache.set(user_query, response)

        return {"result": response, "cache_level": "none"}
```

### 架构示意

```text
用户请求
   ↓
[L1: 精确缓存] ─命中→ 返回（~1ms）
   ↓ 未命中
[L2: 语义缓存] ─命中→ 返回（~10ms）
   ↓ 未命中
[L3: Prefix Cache] ─命中→ 调用 LLM（前缀复用，~1s）
   ↓ 未命中
[L4: 完整 LLM 调用]（~3-10s）
   ↓
 回填所有缓存层
```

---

## 缓存失效策略

缓存不是建好就完事了。**什么时候让缓存失效**，和**怎么建缓存**一样重要。

### 常见失效策略

| 策略                | 说明                       | 适用场景                 |
| ------------------- | -------------------------- | ------------------------ |
| TTL（时间过期）     | 设定固定过期时间           | 天气、新闻等时效性数据   |
| LRU（最近最少使用） | 淘汰最久没被访问的条目     | 内存有限时的通用策略     |
| 版本失效            | 模型/Prompt 变更时失效     | 模型升级、Prompt 迭代    |
| 主动失效            | 业务数据变化时清除相关缓存 | 数据库更新后清除查询缓存 |

### 代码示例：带版本的缓存

```python
class VersionedCache:
    """模型或 Prompt 版本变化时自动失效"""

    def __init__(self):
        self.cache = {}

    def _make_key(self, query, model_version, prompt_version):
        raw = f"{query}|{model_version}|{prompt_version}"
        return hashlib.sha256(raw.encode()).hexdigest()

    def get(self, query, model_version, prompt_version):
        key = self._make_key(query, model_version, prompt_version)
        return self.cache.get(key)

    def set(self, query, model_version, prompt_version, response):
        key = self._make_key(query, model_version, prompt_version)
        self.cache[key] = response

# 当模型版本或 Prompt 版本更新时，旧缓存自动失效
cache = VersionedCache()
cache.set("什么是 Agent", model_version="gpt-4-0125", prompt_version="v2.3",
          response="...")

# 模型升级后，之前的缓存不会命中
cache.get("什么是 Agent", model_version="gpt-4-0613", prompt_version="v2.3")
# → None（版本不同，不命中）
```

---

## 缓存的风险与应对

### 1. 缓存投毒

**风险**：如果一次 LLM 调用产生了错误结果，并被缓存了下来，后续所有相同请求都会拿到错误结果。

**应对**：

```python
def safe_cache_set(cache, query, response):
    """缓存前做质量检查"""
    # 简单的质量检查
    if len(response) < 10:
        return  # 回答太短，可能有问题
    if "我不确定" in response or "抱歉" in response:
        return  # 不缓存不确定的回答

    cache.set(query, response)
```

### 2. 信息过时

**风险**：缓存了"今天天气"的结果，明天还在返回昨天的天气。

**应对**：

- 对时效性请求设置短 TTL 或不缓存
- 在缓存 key 中包含日期信息
- 对包含"今天"、"现在"、"最新"等词的请求谨慎缓存

### 3. 语义缓存误判

**风险**："Python 怎么排序列表"和"Python 怎么排序字典"语义相近但答案不同。

**应对**：

- 提高相似度阈值（建议 0.95 以上）
- 对关键词做额外的精确匹配校验
- 返回缓存结果时标注"来自缓存"，让用户可以要求刷新

---

## 实际应用建议

### Agent 系统中的缓存点

```text
用户请求
   ↓
[意图识别] ← 可缓存（同输入同输出）
   ↓
[RAG 检索] ← 检索结果可缓存
   ↓
[Prompt 构造]
   ↓
[LLM 调用] ← 主要缓存目标
   ↓
[工具调用] ← 工具结果可缓存（API 查询等）
   ↓
[结果格式化] ← 可缓存
   ↓
返回用户
```

### 成本估算公式

```text
月度节省 = 月调用量 × 缓存命中率 × 每次调用均价

例如：
- 月调用量: 100 万次
- 缓存命中率: 40%
- 每次调用均价: $0.05
- 月度节省: 1,000,000 × 0.4 × $0.05 = $20,000
```

### 监控指标

生产环境中建议监控这些缓存指标：

```python
class CacheMetrics:
    """缓存监控指标"""

    def report(self):
        return {
            "hit_rate": self.hits / (self.hits + self.misses),
            "avg_hit_latency_ms": self.hit_latency.avg(),
            "avg_miss_latency_ms": self.miss_latency.avg(),
            "cache_size_mb": self.get_cache_size(),
            "estimated_savings_usd": self.hits * self.avg_cost_per_call,
            "stale_rate": self.stale_responses / self.hits,  # 过时响应比例
        }
```

## 总结

| 缓存类型        | 实现位置   | 命中条件         | 节省程度           |
| --------------- | ---------- | ---------------- | ------------------ |
| 精确缓存        | 应用层     | 输入完全相同     | 100%（命中时）     |
| 语义缓存        | 应用层     | 输入语义相似     | 100%（命中时）     |
| Prompt/前缀缓存 | 提供商层   | 共享 Prompt 前缀 | 50-90% 输入成本    |
| KV Cache        | 模型推理层 | 自动（推理内部） | 推理速度提升数十倍 |

- **精确缓存**是最安全的起点，`temperature=0` 的场景优先使用。
- **语义缓存**能显著提高命中率，但需要谨慎设置阈值。
- **Prompt 缓存**几乎是免费午餐——只要把 System Prompt 放在前面，提供商自动优化。
- 生产系统建议使用**多级缓存**，逐层兜底。
- 始终监控缓存命中率和过时率，缓存不是"设了就忘"的东西。
