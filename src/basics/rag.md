---
outline: [2, 3]
---

# RAG（检索增强生成）

## 什么是 RAG

**RAG**（Retrieval-Augmented Generation，检索增强生成）是一种将**信息检索**与**文本生成**相结合的技术架构。它让大语言模型在生成回答之前，先从外部知识库中检索相关信息，然后基于检索到的内容进行生成，从而产出更准确、更具时效性的回答。

> 类比：如果 LLM 是一个「博览群书但记忆有保质期的专家」，RAG 就是给他配了一套「实时查阅资料库的能力」——回答问题前先查资料，再结合自己的知识给出回答。

## 为什么需要 RAG

大语言模型存在几个固有限制，RAG 正是为解决这些问题而设计的：

| 问题               | 表现                                     | RAG 如何解决                   |
| ------------------ | ---------------------------------------- | ------------------------------ |
| **知识截止**       | 模型训练数据有截止日期，无法了解最新信息 | 检索实时更新的知识库           |
| **幻觉问题**       | 模型可能自信地编造不存在的事实           | 用检索到的真实文档作为生成依据 |
| **领域知识缺失**   | 通用模型不了解企业内部知识               | 接入企业私有知识库             |
| **上下文窗口限制** | 无法一次性将所有文档塞入 prompt          | 只检索最相关的片段             |
| **可溯源性**       | 无法知道回答依据了什么信息               | 可以引用具体来源和文档         |

## 核心架构

RAG 的完整工作流程分为两大阶段：**索引阶段**（离线准备）和**检索生成阶段**（在线服务）。

```
┌──── 索引阶段（离线） ────────────────────────────────────────┐
│                                                            │
│  文档集 → [分块] → [Embedding] → [存入向量数据库]            │
│                                                            │
│  📄 PDF    ┌──────┐   ┌──────────┐   ┌──────────────────┐  │
│  📄 Markdown→ Chunks│→ │Embedding │ → │ Vector Database  │  │
│  📄 HTML   └──────┘   │  Model   │   │ (Milvus/Pinecone)│  │
│  📄 代码             └──────────┘   └──────────────────┘  │
└────────────────────────────────────────────────────────────┘

┌──── 检索生成阶段（在线） ──────────────────────────────────────┐
│                                                              │
│  用户问题 → [Query Embedding] → [相似度搜索] → [构建 Prompt] → [LLM 生成]
│                                                              │
│  "K8s Pod 一直        ┌────────┐     Top-K       ┌─────┐    │
│   CrashLoopBackOff   │向量数据库│ → 相关文档片段 → │ LLM │→ 回答
│   怎么排查？"         └────────┘                  └─────┘    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## 核心概念详解

### 1. 文档分块（Chunking）

将原始文档切分成适合检索的小片段。分块策略直接影响检索质量。

**主要分块方法：**

| 方法             | 原理                                     | 适用场景     | 优缺点             |
| ---------------- | ---------------------------------------- | ------------ | ------------------ |
| **固定大小分块** | 按字符/token 数量均匀切分                | 通用文本     | 简单但可能切断语义 |
| **语义分块**     | 按段落、章节等自然边界切分               | 结构化文档   | 语义完整但大小不均 |
| **递归分块**     | 按层级分隔符（\n\n → \n → 句号）逐层尝试 | 大多数场景   | 兼顾语义和大小     |
| **滑动窗口**     | 相邻块有重叠部分                         | 防止信息丢失 | 增加存储和计算成本 |

**示例：递归分块**

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,          # 每块最大 500 字符
    chunk_overlap=50,        # 相邻块重叠 50 字符
    separators=["\n\n", "\n", "。", "，", " "],  # 优先在段落边界切分
)

chunks = splitter.split_text(document_content)
# 结果：["第一个语义完整的片段...", "第二个片段...", ...]
```

### 2. 嵌入（Embedding）

将文本转化为高维向量，使得语义相似的文本在向量空间中距离接近。

```python
from openai import OpenAI

client = OpenAI()

# 将文本转为向量
response = client.embeddings.create(
    model="text-embedding-3-small",
    input="Kubernetes Pod CrashLoopBackOff 的常见原因和排查方法"
)

embedding = response.data[0].embedding
# 结果：[0.0234, -0.0156, 0.0891, ...] （1536 维向量）
```

**常用 Embedding 模型：**

| 模型                   | 提供商  | 维度 | 特点               |
| ---------------------- | ------- | ---- | ------------------ |
| text-embedding-3-small | OpenAI  | 1536 | 性价比高，通用性好 |
| text-embedding-3-large | OpenAI  | 3072 | 精度更高           |
| bge-large-zh           | BAAI    | 1024 | 中文优化           |
| jina-embeddings-v3     | Jina AI | 1024 | 多语言支持好       |

### 3. 向量检索（Vector Search）

根据查询向量在向量数据库中找到最相似的文档片段。

```python
import chromadb

# 创建向量数据库集合
client = chromadb.Client()
collection = client.create_collection("knowledge_base")

# 插入文档（自动生成 embedding）
collection.add(
    documents=[
        "Pod CrashLoopBackOff 通常是因为容器启动后立即退出。常见原因包括：1) 应用程序错误导致进程崩溃...",
        "OOMKilled 表示容器因内存不足被 Kubernetes 终止。解决方案：增加 resources.limits.memory...",
        "ImagePullBackOff 表示 Kubernetes 无法拉取容器镜像。检查：1) 镜像名称是否正确..."
    ],
    ids=["doc1", "doc2", "doc3"],
    metadatas=[
        {"source": "k8s-troubleshooting.md", "section": "pod-issues"},
        {"source": "k8s-troubleshooting.md", "section": "memory"},
        {"source": "k8s-troubleshooting.md", "section": "image"},
    ]
)

# 检索最相关的文档
results = collection.query(
    query_texts=["Pod 一直重启怎么办"],
    n_results=3
)
# 返回与查询语义最接近的文档片段
```

### 4. 上下文构建与生成

将检索到的文档片段组装成 prompt，交给 LLM 生成最终回答。

```python
def generate_rag_response(question: str, retrieved_docs: list[str]) -> str:
    # 构建增强 prompt
    context = "\n\n---\n\n".join(retrieved_docs)

    prompt = f"""基于以下参考资料回答用户问题。
如果参考资料中没有相关信息，请明确说明"我没有找到相关信息"，不要编造答案。
回答时请引用参考资料的来源。

## 参考资料
{context}

## 用户问题
{question}

## 回答
"""
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1  # 低温度，减少创造性发挥
    )

    return response.choices[0].message.content
```

## 完整示例：企业知识库问答系统

```python
from openai import OpenAI
import chromadb

client = OpenAI()
chroma = chromadb.PersistentClient(path="./vector_db")
collection = chroma.get_or_create_collection(
    name="ops_knowledge",
    metadata={"hnsw:space": "cosine"}  # 使用余弦相似度
)

class RAGPipeline:
    """企业级 RAG 问答管道"""

    def __init__(self, collection, top_k=5, score_threshold=0.7):
        self.collection = collection
        self.top_k = top_k
        self.score_threshold = score_threshold

    def ingest(self, documents: list[dict]):
        """索引阶段：将文档导入向量数据库"""
        for doc in documents:
            # 分块
            chunks = self._chunk(doc["content"])
            for i, chunk in enumerate(chunks):
                self.collection.add(
                    documents=[chunk],
                    ids=[f"{doc['id']}_chunk_{i}"],
                    metadatas=[{
                        "source": doc["source"],
                        "title": doc["title"],
                        "chunk_index": i,
                        "updated_at": doc.get("updated_at", "")
                    }]
                )

    def query(self, question: str) -> dict:
        """检索生成阶段：回答用户问题"""
        # 1. 检索相关文档
        results = self.collection.query(
            query_texts=[question],
            n_results=self.top_k
        )

        # 2. 过滤低质量结果
        relevant_docs = []
        for doc, metadata, distance in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0]
        ):
            score = 1 - distance  # 余弦距离转相似度
            if score >= self.score_threshold:
                relevant_docs.append({
                    "content": doc,
                    "source": metadata["source"],
                    "score": score
                })

        # 3. 生成回答
        if not relevant_docs:
            return {
                "answer": "抱歉，我没有找到与您问题相关的信息。",
                "sources": [],
                "confidence": "low"
            }

        context = "\n\n".join([
            f"[来源: {d['source']}] (相关度: {d['score']:.2f})\n{d['content']}"
            for d in relevant_docs
        ])

        answer = self._generate(question, context)

        return {
            "answer": answer,
            "sources": [d["source"] for d in relevant_docs],
            "confidence": "high" if relevant_docs[0]["score"] > 0.85 else "medium"
        }

    def _chunk(self, text: str, size=500, overlap=50) -> list[str]:
        """简单的滑动窗口分块"""
        chunks = []
        start = 0
        while start < len(text):
            end = start + size
            chunks.append(text[start:end])
            start = end - overlap
        return chunks

    def _generate(self, question: str, context: str) -> str:
        """调用 LLM 生成回答"""
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "你是一个企业知识库助手。基于提供的参考资料回答问题，引用来源。如果资料不足，明确说明。"},
                {"role": "user", "content": f"参考资料：\n{context}\n\n问题：{question}"}
            ],
            temperature=0.1
        )
        return response.choices[0].message.content

# 使用示例
rag = RAGPipeline(collection)

# 导入文档
rag.ingest([
    {
        "id": "doc_001",
        "title": "K8s 故障排查手册",
        "source": "ops-wiki/k8s-troubleshooting.md",
        "content": "Pod CrashLoopBackOff 排查步骤：1. 使用 kubectl logs <pod> 查看容器日志...",
        "updated_at": "2026-01-15"
    }
])

# 查询
result = rag.query("Pod 一直 CrashLoopBackOff 怎么排查？")
print(result["answer"])
print(f"来源: {result['sources']}")
print(f"置信度: {result['confidence']}")
```

## 高级优化策略

### 1. 查询改写（Query Rewriting）

用户的原始查询往往不是最佳的检索查询。通过改写可以提升召回率。

```python
def rewrite_query(original_query: str) -> list[str]:
    """将用户查询改写为多个检索友好的查询"""
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "user",
            "content": f"""将以下用户问题改写为 3 个不同角度的搜索查询，以提高检索覆盖率。
只输出查询列表，每行一个。

用户问题：{original_query}"""
        }]
    )
    return response.choices[0].message.content.strip().split("\n")

# 示例
# 原始查询："服务挂了"
# 改写后：
# - "服务不可用 故障排查 服务宕机"
# - "微服务 health check 失败 重启"
# - "生产环境 服务异常 日志报错"
```

### 2. 重排序（Re-ranking）

对初步检索结果进行二次排序，提升精确度。

```python
def rerank(query: str, documents: list[str], top_k: int = 3) -> list[str]:
    """使用交叉编码器对检索结果重排序"""
    # 使用 LLM 评估每个文档与查询的相关性
    scored_docs = []
    for doc in documents:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": f"评估以下文档与查询的相关性，输出 0-10 的分数。\n查询：{query}\n文档：{doc}\n分数："
            }]
        )
        score = float(response.choices[0].message.content.strip())
        scored_docs.append((doc, score))

    # 按分数排序，返回 top_k
    scored_docs.sort(key=lambda x: x[1], reverse=True)
    return [doc for doc, _ in scored_docs[:top_k]]
```

### 3. 混合检索（Hybrid Search）

结合向量检索（语义匹配）和关键词检索（精确匹配）的优势。

```
用户查询
    │
    ├── 向量检索（语义相似度）── 找到概念相关的文档
    │
    ├── 关键词检索（BM25）──── 找到包含精确术语的文档
    │
    └── 融合排序（RRF/加权）── 综合两种结果给出最终排名
```

## RAG 评估指标

| 指标             | 说明                         | 衡量方法                   |
| ---------------- | ---------------------------- | -------------------------- |
| **检索召回率**   | 正确答案是否在检索结果中     | 标注测试集对比             |
| **检索精确率**   | 检索结果中有多少是真正相关的 | 人工标注 + 自动化评估      |
| **回答忠实度**   | 回答是否忠于检索到的文档     | 检查回答是否有文档外的臆断 |
| **回答相关性**   | 回答是否真正解决了用户的问题 | 用户满意度评估             |
| **端到端准确率** | 最终回答是否正确             | 标注答案对比               |

## 常见问题与解决方案

| 问题             | 原因                            | 解决方案                            |
| ---------------- | ------------------------------- | ----------------------------------- |
| 检索不到相关文档 | 查询与文档用词差异大            | 查询改写 + 混合检索                 |
| 检索到但不相关   | 分块粒度不当或 embedding 模型弱 | 优化分块策略 + 换用更好的模型       |
| 回答不准确       | 上下文太多或太少                | 调整 top_k + 加入重排序             |
| 回答有幻觉       | LLM 忽略了上下文                | 降低 temperature + 强化 prompt 约束 |
| 时效性差         | 知识库未及时更新                | 增量索引 + 定期刷新策略             |

## RAG 的核心作用

1. **知识时效性**：让模型获取训练截止日期之后的最新信息，解决知识过期问题。
2. **减少幻觉**：通过真实文档作为生成依据，显著降低模型编造内容的概率。
3. **领域适配**：无需微调模型，只需接入特定领域知识库即可获得专业能力。
4. **可解释性**：每个回答都可以追溯到具体的来源文档，支持事实核查。
5. **数据安全**：企业私有数据留在自己的知识库中，不需要发送给模型供应商进行训练。

> **一句话总结**：RAG 是让 Agent 「言之有据」的核心技术——先查再答，有据可依。
