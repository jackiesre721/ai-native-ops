# AI 原生运维体系：以云原生为底座的生产控制系统

> 一本以 **AI 原生运维（AI-native Ops）为主旨**的书：终局是把生产系统运维成 L3 智能自治的生产控制系统；云原生不是并列的另一个主范式，而是这条路的底座与技能基座。

🌐 **在线阅读**：<https://jackiesre721.github.io/ai-native-ops/>

## 这本书讲什么

以 AI 原生运维为纲：第一篇立论（为什么它是终局、云原生为什么是必经底座），第二至四篇是主旨的底座与治理基座（K8s 底座 → 声明式交付 → 可观测与稳定性），第五篇是主线的落地与终局（平台封装 → 运维自治闭环 → Agent 引擎）。底座逐层建立资源控制、交付控制、观测控制、稳定性控制、能力控制，最终抵达智能决策控制——终局即主旨。全书以**三层递进自治模型**为独家主线：

- **L1 机械自治**（第 5 章）：K8s 声明式调谐闭环——基础设施层稳态自愈
- **L2 运维自治**（第 16 章）：SRE 观测驱动闭环——业务稳定性自动化治理
- **L3 智能自治**（16.4⑤/16.5）：Agent 引擎闭环——"AI 驱动、人审核"的智能自治落地

## 结构（15 章 + 2 附录，五篇 · V1.9 主旨聚焦）

| 篇 | 章节 | 主题 |
|---|---|---|
| 第一篇 现代运维范式 | 第 1–3 章 | AI 原生运维立论与云原生底座定位（主旨） |
| 第二篇 Kubernetes 底座 | 第 4–5、7–8 章 | 生产级核心底座（底座·选读） |
| 第三篇 声明式交付体系 | 第 9–11 章 | IaC / GitOps / 灰度 |
| 第四篇 可观测与稳定性 | 第 12–14 章 | OTel / SLO / SRE |
| 第五篇 平台工程与自治 | 第 15–16 章 | 平台封装 / 运维自治闭环 / Agent 引擎落地（终章） |
| 附录 | A / B | 安全基线 / 故障闭环案例 |

技术栈锁死（双层参考栈）：**基础设施层 = 云托管生态（阿里云 ACK 主参考、AWS EKS 对照，不自建 K8s）** + 平台层自建栈：VictoriaMetrics / Loki / Tempo / OpenTelemetry / Grafana + Helm / ArgoCD / Argo Rollouts + LLM API（百炼 DashScope 主参考、Bedrock 对照，建议式分诊引擎）。写作铁律见 `docs/CONVENTIONS.md`（V1.1：每节落地三件套——可运行制品/云服务映射/数字）。

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
