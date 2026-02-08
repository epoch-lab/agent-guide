import { defineConfigWithTheme } from 'vitepress'
import type { ThemeConfig } from 'vitepress-carbon'
import baseConfig from 'vitepress-carbon/config'

// https://vitepress.dev/reference/site-config
export default defineConfigWithTheme<ThemeConfig>({
  extends: baseConfig,
  lang: 'zh-CN',
  title: 'Agent-Guide',
  description: '面向中文开发者的 AI Agent 知识分享站，覆盖基础概念、开源项目与工程实践。',
  srcDir: 'src',
  //base: '/vitepress-carbon-template/', if running on github-pages, set repository name here

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '首页', link: '/' },
      { text: '基础知识', link: '/basics/' },
      { text: '应用开发', link: '/agent-dev/' },
      { text: '开源项目', link: '/open-source-agents/' },
      { text: 'Vibe Coding', link: '/vibe-coding/' }
    ],

    search: {
      provider: 'local'
    },

    sidebar: [
      {
        text: '基础知识',
        items: [
          { text: '总览', link: '/basics/' },
          { text: 'Skill', link: '/basics/skill' },
          { text: 'MCP', link: '/basics/mcp' },
          { text: 'Tool Call', link: '/basics/tool-call' }
        ]
      },
      {
        text: '应用开发',
        items: [
          { text: '总览', link: '/agent-dev/' },
          { text: '架构设计', link: '/agent-dev/architecture' },
          { text: '上下文工程', link: '/agent-dev/context-engineering' },
          { text: '工具编排', link: '/agent-dev/tool-orchestration' }
        ]
      },
      {
        text: '开源 Agent',
        items: [
          { text: '总览', link: '/open-source-agents/' },
          { text: 'OpenClaw', link: '/open-source-agents/openclaw' },
          { text: 'Nanobot', link: '/open-source-agents/nanobot' }
        ]
      },
      {
        text: 'Vibe Coding 调优',
        items: [
          { text: '总览', link: '/vibe-coding/' },
          { text: '调优作战手册', link: '/vibe-coding/optimization-playbook' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/epoch-lab/agent-guide' }
    ],
  }
})
