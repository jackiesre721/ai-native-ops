# 现代运维体系：从云原生到 AI 原生

> 一本讲现代生产运维如何演进为**声明式、可观测、可治理、可自治的生产控制系统**的书。

🌐 **在线阅读**：<https://jackiesre721.github.io/ai-native-ops/>

## 这本书讲什么

从不可变基础设施出发，逐层完成资源控制、交付控制、观测控制、稳定性控制、能力控制，最终抵达智能决策控制。全书以**三层递进自治模型**为独家主线：

- **L1 机械自治**（第 5 章）：K8s 声明式调谐闭环——基础设施层稳态自愈
- **L2 运维自治**（第 16 章）：SRE 观测驱动闭环——业务稳定性自动化治理
- **L3 智能自治**（第 18 章）：AI 推理自适应闭环——复杂 AI 负载动态自治优化

## 结构（18 章 + 2 附录，六篇）

| 篇 | 章节 | 主题 |
|---|---|---|
| 第一篇 现代运维范式 | 第 1–3 章 | 云原生与 AI 原生顶层架构（立论） |
| 第二篇 Kubernetes 底座 | 第 4–8 章 | 生产级核心底座 |
| 第三篇 声明式交付体系 | 第 9–11 章 | IaC / GitOps / 灰度 |
| 第四篇 可观测与稳定性 | 第 12–14 章 | OTel / SLO / SRE |
| 第五篇 平台工程与自治 | 第 15–16 章 | 平台封装 / 运维自治闭环 |
| 第六篇 AI 原生运维 | 第 17–18 章 | 异构算力 / 推理性能 / 智能自治 |
| 附录 | A / B | 安全基线 / 五大故障案例 |

技术栈锁死（双层参考栈）：**基础设施层 = 云托管生态（阿里云 ACK 主参考、AWS EKS 对照，不自建 K8s）** + 平台层自建栈：VictoriaMetrics / Loki / Tempo / OpenTelemetry / Grafana + Helm / ArgoCD / Argo Rollouts + vLLM / SGLang。写作铁律见 `docs/CONVENTIONS.md`（V1.1：每节落地三件套——可运行制品/云服务映射/数字）。

## 本地预览

```bash
npm install
npm run docs:dev       # 开发：http://localhost:5173/ai-native-ops/
npm run docs:build     # 构建：产物在 docs/.vitepress/dist
npm run docs:preview   # 预览构建产物
```

站点用 [VitePress](https://vitepress.dev/) 构建，推送到 `main` 即自动部署到 GitHub Pages（见 `.github/workflows/deploy-docs.yml`）。

## 目录

- 书稿源文件：`docs/`（`NN-*.md` 为各章，`appendix-*.md` 为附录）
- 写作规范（V1.0 冻结规则）：[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md)
- 总览与阅读路径：[`docs/README.md`](docs/README.md)

## License

MIT
