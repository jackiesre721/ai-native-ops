import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid({
  ...defineConfig({
    title: '现代运维体系',
    description: '从云原生到 AI 原生的生产控制系统',
    base: '/ai-native-ops/',

    head: [
      // 注意：data URI 不要加 base 前缀（data: 本身就是绝对地址）
      ['link', { rel: 'icon', type: 'image/svg+xml', href: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🤖</text></svg>' }],
      ['meta', { name: 'theme-color', content: '#3451b2' }]
    ],

    themeConfig: {
      siteTitle: '现代运维体系',
      socialLinks: [
        { icon: 'github', link: 'https://github.com/jackiesre721/ai-native-ops' }
      ],

      search: {
        provider: 'local',
        options: {
          translations: {
            button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
            modal: {
              noResultsText: '无法找到相关结果',
              resetButtonTitle: '清除查询条件',
              footer: { selectText: '选择', navigateText: '切换' }
            }
          }
        }
      },

      nav: [
        { text: '📖 目录', link: '/README' },
        { text: '🏠 首页', link: '/' },
        { text: '📐 写作规范', link: '/CONVENTIONS' },
        { text: '💻 源码', link: 'https://github.com/jackiesre721/ai-native-ops' }
      ],

      sidebar: [
        {
          text: '📖 开始阅读',
          items: [
            { text: '目录与阅读路径', link: '/README' },
            { text: '写作规范（V1.0 冻结规则）', link: '/CONVENTIONS' },
            { text: '生产检查清单速查', link: '/CHECKLIST' },
            { text: '参考文献与深读', link: '/REFERENCES' }
          ]
        },
        {
          text: '第一篇 · 现代运维范式',
          items: [
            { text: '第 1 章 云原生与 AI 原生运维架构演进', link: '/01-cloudnative-ai-evolution' },
            { text: '第 2 章 不可变基础设施与容器软件供应链治理', link: '/02-immutable-infra-supply-chain' },
            { text: '第 3 章 AI 原生运维统一范式', link: '/03-ainative-ops-paradigm' }
          ]
        },
        {
          text: '第二篇 · Kubernetes 底座',
          items: [
            { text: '第 4 章 K8s 分布式架构与生产治理', link: '/04-k8s-architecture-governance' },
            { text: '第 5 章 声明式 API 与控制循环 ★机械自治', link: '/05-declarative-api-reconcile' },
            { text: '第 6 章 Containerd 容器运行时生产运维', link: '/06-containerd-runtime' },
            { text: '第 7 章 K8s 资源与精细化调度治理', link: '/07-k8s-scheduling-resources' },
            { text: '第 8 章 K8s 网络、存储与服务治理', link: '/08-k8s-network-storage' }
          ]
        },
        {
          text: '第三篇 · 声明式交付体系',
          items: [
            { text: '第 9 章 一切即代码：声明式治理全域架构', link: '/09-everything-as-code' },
            { text: '第 10 章 ArgoCD 声明式 GitOps 生产交付', link: '/10-argocd-gitops' },
            { text: '第 11 章 灰度发布与生产变更风险治理', link: '/11-canary-release-risk' }
          ]
        },
        {
          text: '第四篇 · 可观测与稳定性',
          items: [
            { text: '第 12 章 OpenTelemetry 全域可观测体系', link: '/12-opentelemetry-observability' },
            { text: '第 13 章 告警治理、SLO 与故障应急体系', link: '/13-alerting-slo-incident' },
            { text: '第 14 章 SRE 稳定性与资源成本治理', link: '/14-sre-stability-cost' }
          ]
        },
        {
          text: '第五篇 · 平台工程与自治',
          items: [
            { text: '第 15 章 平台工程与开发者自助体系', link: '/15-platform-engineering' },
            { text: '第 16 章 运维能力平台化与自治闭环 ★运维自治', link: '/16-ops-autonomy-loop' }
          ]
        },
        {
          text: '第六篇 · AI 原生运维',
          items: [
            { text: '第 17 章 AI 负载与异构算力生产运维', link: '/17-ai-workload-gpu-ops' },
            { text: '第 18 章 AI 推理性能、KV Cache 与智能自治 ★智能自治', link: '/18-ai-inference-kvcache-autonomy' }
          ]
        },
        {
          text: '📚 附录',
          items: [
            { text: '附录 A 云原生与 AI 原生生产安全基线', link: '/appendix-a-security-baseline' },
            { text: '附录 B 综合实战与五大故障闭环案例', link: '/appendix-b-case-studies' }
          ]
        }
      ],

      outline: { label: '本页目录', level: [2, 3] },
      docFooter: { prev: '上一节', next: '下一节' },
      returnToTopLabel: '回到顶部',
      darkModeSwitchLabel: '主题',
      sidebarMenuLabel: '菜单',
      lastUpdated: { text: '最后更新' },
      footer: { message: 'MIT Licensed', copyright: 'ai-native-ops' }
    },

    markdown: {
      lineNumbers: true,
      theme: { light: 'github-light', dark: 'github-dark' }
    }
  }),
  mermaid: {
    theme: 'base',
    themeVariables: {
      primaryColor: '#3451b2',
      primaryTextColor: '#ffffff',
      primaryBorderColor: '#2a4090',
      lineColor: '#6b7280',
      secondaryColor: '#e0e7ff',
      secondaryTextColor: '#1e3a8a',
      tertiaryColor: '#f1f5f9',
      tertiaryTextColor: '#374151',
      fontSize: '14px'
    }
  }
})
