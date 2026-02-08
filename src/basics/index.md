---
outline: [2, 3]
---

# 基础知识

这一部分用于建立 Agent 工程的共同语言。

没有共同语言，团队常见的问题是开发很快、排障很慢。

## 建议先对齐的四件事

1. `Tool Calling`：模型与外部世界交互的核心调用机制。
2. `MCP`：标准化的上下文与工具通道协议。
3. `Skill`：可复用能力单元，不是一次性提示词。
4. `RAG`：检索增强生成，让模型言之有据。

## 推荐阅读顺序

- [Tool Calling](/basics/tool-call)
- [MCP](/basics/mcp)
- [Skill](/basics/skill)
- [RAG](/basics/rag)

## 完成本章节后你应具备

- 用统一词汇描述 Agent 的行为与边界。
- 理解 Tool Calling、MCP、Skill、RAG 各自的定位和协作关系。
- 判断故障发生在提示层、上下文层还是工具层。
- 在编码前先写出最小可行架构。
