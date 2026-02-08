---
outline: [2, 3]
---

# MCP（Model Context Protocol）

## 什么是 MCP

**MCP**（Model Context Protocol，模型上下文协议）是一个开放标准协议，用于规范大语言模型与外部数据源、工具和服务之间的连接方式。它由 Anthropic 于 2024 年提出，旨在为 AI 应用提供统一的集成接口。

> 类比：如果 Tool Calling 是"一次具体的函数调用"，那么 MCP 就是定义这些调用如何被**发现、注册、组织和管理**的标准协议——就像 USB 协议定义了设备如何与电脑通信一样。

## 为什么需要 MCP

在 MCP 出现之前，每个 AI 应用连接外部工具都需要编写定制化的胶水代码：

```
问题：M 个 AI 应用 × N 个外部系统 = M × N 个集成
```

```
没有 MCP：                         有了 MCP：
┌─────────┐                       ┌─────────┐
│ App A   │──→ API 1              │ App A   │──┐
│         │──→ API 2              │         │  │
│         │──→ API 3              └─────────┘  │
└─────────┘                       ┌─────────┐  │   ┌───────────┐
┌─────────┐                       │ App B   │──┼──→│ MCP 协议层 │──→ 各种服务
│ App B   │──→ API 1              │         │  │   └───────────┘
│         │──→ API 2              └─────────┘  │
│         │──→ API 3              ┌─────────┐  │
└─────────┘                       │ App C   │──┘
┌─────────┐                       └─────────┘
│ App C   │──→ API 1
│         │──→ API 2              复杂度：M + N
│         │──→ API 3
└─────────┘
复杂度：M × N
```

**MCP 的价值**：将 $M \times N$ 的集成复杂度降低为 $M + N$。

## 核心架构

MCP 采用客户端-服务器（Client-Server）架构：

```
┌──────────────────────────────────────────────────┐
│                   Host 应用                       │
│  (Claude Desktop / IDE / 自定义 Agent)            │
│                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │ MCP Client │  │ MCP Client │  │ MCP Client │  │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  │
└────────┼───────────────┼───────────────┼─────────┘
         │               │               │
         ▼               ▼               ▼
   ┌───────────┐   ┌───────────┐   ┌───────────┐
   │MCP Server │   │MCP Server │   │MCP Server │
   │  文件系统  │   │  数据库    │   │  GitHub   │
   └───────────┘   └───────────┘   └───────────┘
```

### 三大角色

| 角色           | 职责                                  | 示例                                  |
| -------------- | ------------------------------------- | ------------------------------------- |
| **Host**       | 宿主应用，管理 MCP Client 的生命周期  | Claude Desktop、VS Code、自定义 Agent |
| **MCP Client** | 与 MCP Server 建立 1:1 连接，转发请求 | 内嵌在 Host 中的协议客户端            |
| **MCP Server** | 暴露能力，响应请求                    | 文件系统服务、数据库连接器、API 网关  |

## 三大核心能力（Primitives）

MCP Server 可以暴露三种类型的能力：

### 1. Resources（资源）

资源是模型可以读取的**数据**，类似于 REST 中的 GET 端点。资源是只读的，不产生副作用。

```json
{
  "uri": "file:///project/src/main.py",
  "name": "主程序源码",
  "mimeType": "text/x-python",
  "description": "项目的主入口文件"
}
```

**使用场景**：读取文件内容、获取数据库表结构、查看配置信息。

### 2. Tools（工具）

工具是模型可以调用的**函数**，会产生副作用，类似于 REST 中的 POST 端点。

```json
{
  "name": "execute_sql",
  "description": "在 PostgreSQL 数据库上执行 SQL 查询",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "SQL 查询语句" },
      "database": { "type": "string", "description": "目标数据库名称" }
    },
    "required": ["query", "database"]
  }
}
```

**使用场景**：执行数据库操作、调用外部 API、创建文件。

### 3. Prompts（提示模板）

提示模板是预定义的交互模式，帮助用户高效地使用工具和资源。

```json
{
  "name": "code_review",
  "description": "对代码进行结构化审查",
  "arguments": [
    { "name": "code", "description": "需要审查的代码", "required": true },
    { "name": "language", "description": "编程语言", "required": false }
  ]
}
```

**使用场景**：标准化的代码审查流程、固定格式的报告生成。

## 实战示例：构建一个 MCP Server

以下是一个使用 Python SDK 构建简单 MCP Server 的示例：

```python
from mcp.server import Server
from mcp.types import Tool, TextContent
import json

# 创建 MCP Server 实例
server = Server("demo-server")

# 注册工具
@server.tool()
async def query_user(user_id: str) -> str:
    """
    根据用户 ID 查询用户信息。

    Args:
        user_id: 用户的唯一标识符
    """
    # 模拟数据库查询
    users_db = {
        "u001": {"name": "张三", "email": "zhangsan@example.com", "role": "admin"},
        "u002": {"name": "李四", "email": "lisi@example.com", "role": "user"},
    }

    user = users_db.get(user_id)
    if user:
        return json.dumps(user, ensure_ascii=False)
    else:
        return json.dumps({"error": f"用户 {user_id} 不存在"}, ensure_ascii=False)

# 注册资源
@server.resource("config://app-settings")
async def get_app_settings() -> str:
    """返回应用配置信息"""
    return json.dumps({
        "version": "2.1.0",
        "environment": "production",
        "max_connections": 100
    })
```

## 传输方式

MCP 支持两种传输方式：

| 传输方式       | 特点                                         | 适用场景                        |
| -------------- | -------------------------------------------- | ------------------------------- |
| **stdio**      | 通过标准输入/输出通信，Server 作为子进程启动 | 本地集成，如 IDE 插件、CLI 工具 |
| **HTTP + SSE** | 基于 HTTP 的远程通信，Server 作为独立服务    | 远程服务、多用户共享、云部署    |

## 安全与治理

### 权限控制原则

```yaml
# 最小权限示例
mcp_server: database-connector
permissions:
  resources:
    - "schema://*" # 允许读取表结构
    - "data://read-only/*" # 只读数据访问
  tools:
    - "execute_select" # 只允许 SELECT 查询
    # - "execute_write"  # 禁止写入操作
  audit:
    log_level: "all"
    retention_days: 90
```

### 关键治理规则

1. **能力注册审核**：每个新增的 Tool / Resource 必须经过安全审查。
2. **版本管理**：接口变更必须向后兼容，或通过版本号隔离。
3. **可观测性**：所有请求必须携带 trace ID，支持全链路追踪。
4. **最小权限**：Server 只暴露完成任务所需的最少能力。

### 风险矩阵

| 风险       | 表现                         | 控制策略                  |
| ---------- | ---------------------------- | ------------------------- |
| 数据泄露   | Resource 暴露了敏感信息      | 字段级权限控制 + 数据脱敏 |
| 越权执行   | Tool 被滥用执行危险操作      | 分级审批 + 运行时护栏     |
| 提示注入   | 恶意输入操纵 Server 行为     | 输入消毒 + 参数校验       |
| 可用性风险 | Server 故障导致 Agent 不可用 | 健康检查 + 降级策略       |

## MCP 的核心作用

1. **标准化集成**：一次实现、处处可用——同一个 MCP Server 可被所有支持 MCP 的 AI 应用使用。
2. **关注点分离**：AI 应用专注推理（reasoning），MCP Server 专注能力提供（capability），界限清晰。
3. **安全边界**：通过协议层统一实施权限控制、审计日志和输入校验。
4. **生态复用**：社区可以共享和组合 MCP Server，加速 Agent 开发。

> **一句话总结**：MCP 是 Agent 能力的「USB-C 接口」——标准化、可插拔、即插即用。
