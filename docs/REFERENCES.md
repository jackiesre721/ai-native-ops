# REFERENCES — 全书参考文献与权威深读

> 这一层给全书**理论溯源 + 工业验证 + 深度延展**。本书原理与组件无关（去工具化，见 CONVENTIONS 三），但每个核心论断都有出处——读者想深挖、查证、或对比选型时，从这里出发。
> 说明：链接以官方最新为准，可能随版本/站点更新漂移；优先认域名，不认死链。

---

## 第一篇 · 现代运维范式（第 1–3 章：演进立论 / 不可变 / AI 原生范式）

- **阿里云《云原生时代的运维体系进化》**：<https://developer.aliyun.com/article/845278> — CloudOps / 不可变基础设施 / 声明式 API / GitOps / 混沌工程，阿里云大规模实践沉淀，为第一篇"云原生→AI 原生演进"提供宏观架构背书。
- **Google《Site Reliability Engineering》(SRE Book)**：<https://sre.google/books/> — SRE 理念、SLI/SLO、错误预算、Toil、自动化优先，是全书稳定性与自治理念的源头。
- **CNCF Cloud Native Definition v1.1**：<https://github.com/cncf/toc/blob/main/DEFINITION.md> — 云原生的权威定义（不可变基础设施 + 声明式 API + 微服务 + 运行可弹性）。
- **《The Twelve-Factor App》**：<https://12factor.net/> — 不可变、配置外置、声明式的工程基线。
- **《The DevOps Handbook》** / **《The Phoenix Project》** — 运维三代范式（被动救火 → 自动化 → 自治）的业务叙事与流动/反馈/持续学习三步法。

## 第二篇 · Kubernetes 底座（第 4–8 章）

- **Kubernetes 官方文档**：<https://kubernetes.io/docs/> — 全篇底座参考。
- **K8s Controller / Reconcile 模式**：<https://kubernetes.io/docs/concepts/architecture/controller/> — 第 5 章"期望状态→调谐→实际状态"的官方定义（L1 机械自治的来源）。
- **OCI Image / Runtime Spec**：<https://github.com/opencontainers> — 第 2 章 OCI 规范、镜像/运行时标准。
- **containerd 文档**：<https://containerd.io/docs/> — CRI 运行时官方文档（原第 6 章 V1.7 瘦身，作延伸深读）。
- **CNI Spec**：<https://www.cni.dev/> ；**CSI**：<https://kubernetes-csi.github.io/docs/> — 第 8 章网络/存储接口标准。
- **Raft 论文《In Search of an Understandable Consensus Algorithm》**：<https://raft.github.io/raft.pdf> — 第 4 章 etcd 高可用（奇数多副本/多数派）的共识基础。
- **K8s 调度框架**：<https://kubernetes.io/docs/concepts/scheduling-eviction/> — 第 7 章调度/亲和/污点/拓扑分布。

## 第三篇 · 声明式交付（第 9–11 章）

- **《Infrastructure as Code》(Kief Morris, O'Reilly)** — 第 9 章 IaC 思想与"配置即代码 vs 基础设施即代码"的辨析来源。
- **Helm 文档**：<https://helm.sh/docs/> — 第 9/10 章 chart 标准化打包。
- **OpenGitOps 原则（4 条）**：<https://opengitops.dev/> — 第 10 章"声明式 / 拉模式 / 持续同步 / 可回滚"四特性的权威定义。
- **ArgoCD 文档**：<https://argo-cd.readthedocs.io/> ；**Argo Rollouts**：<https://argo-rollouts.readthedocs.io/> — 第 10/11 章 GitOps + 金丝雀参考实例。
- **Flux（对照参考，本书 V2）**：<https://fluxcd.io/> — GitOps 另一主流实现，对照理解"机制相同、实现不同"。
- **Martin Fowler《CanaryRelease》**：<https://martinfowler.com/bliki/CanaryRelease.html> — 第 11 章灰度/金丝雀的概念溯源。

## 第四篇 · 可观测与稳定性（第 12–14 章）

- **OpenTelemetry 官方文档**：<https://opentelemetry.io/docs/> — 第 12 章三支柱统一采集、exemplar、collector 拓扑的权威来源。
- **《Observability Engineering》(Majumdar, Fong-Jones, Miranda, O'Reilly)** — 可观测 vs 监控、三支柱协同的方法论。
- **VictoriaMetrics 文档**：<https://docs.victoriametrics.com/> — 第 12 章指标存储/exemplar/long-term；含与 Prometheus 的对照。
- **Grafana 栈文档（Loki / Tempo / Grafana）**：<https://grafana.com/docs/> — 第 12 章日志/链路/可视化 + trace ID 关联 + exemplar 渲染。
- **Google《The Site Reliability Workbook》** + **《Implementing Service Level Objectives》(Alex Hidalgo)** — 第 13 章 SLI/SLO/错误预算的落地方法（多窗口多燃烧率告警等）。
- **Principles of Chaos**：<https://principlesofchaos.org/> — 第 13.5 节混沌工程核心思想；Netflix Chaos Monkey 为工业实践。
- **OpenMetrics / exemplar in Prometheus**：<https://github.com/OpenObservability/OpenMetrics/blob/main/specification/OpenMetrics.md> — 第 12.1 节 exemplar 的协议规范（含"前提条件"）。

## 第五篇 · 平台工程与自治（第 15–16 章）

- **《Team Topologies》(Matthew Skelton)** — 第 15 章平台团队、团队交互模式（Stream-aligned / Platform）、黄金路径的理论基础。
- **Platform Engineering 社区**：<https://platformengineering.org/> — 平台工程定义与文章集。
- **KEDA 文档**：<https://keda.sh/docs/> — 第 16.3 节事件驱动弹性（托管 HPA、ScaledObject、scale-to-zero）的权威实现。
- **《Accelerate》(DORA)** — 研发效能/交付频率/稳定性指标，平台工程的价值度量。

## 延伸深读 · 运维 Agent 与 LLM 引擎（主旨方向）

- **阿里云 STAROps（全域智能运维平台）**：<https://help.aliyun.com/zh/starops/product-overview/> — 运维 Agent 的托管实例：自然语言诊断 / RCA / 数字员工编排，16.4 / 16.5"L3 承载形态"的商业印证。
- **AWS DevOps Agent**：<https://aws.amazon.com/devops-agent/> — 自主 SRE Agent（2026 年 GA）：24/7 自主 triage + RCA + 处置建议（建议式而非全自主执行），16.4⑤/16.5 的托管对照。
- **阿里云百炼 DashScope 文档**：<https://help.aliyun.com/zh/model-studio/> — 16.4⑤ 分诊器模型 API 的主参考（兼容协议，对照 AWS Bedrock）。
- **OpenAI Cookbook（结构化输出与评测）**：<https://cookbook.openai.com/> — JSON mode / few-shot / 评测集设计的工程实践，16.5② 评测门禁的方法参照。

> AI 训练/推理负载运维方向（GPU 调度、KV Cache、推理性能等）V1.11 判定与主旨无关，已移出本书范围，本清单不再收录。

## 附录 / 全书方法论

- **DDIA《Designing Data-Intensive Applications》(Martin Kleppmann)** — 本书"原理优先 / 去工具化 / 辩证权衡"写作哲学的范本，三支柱协同、控制闭环等思想与之同源。
- **《Google SRE Book》三件套（SRE / Workbook / 核心论文集）** — 全书稳定性/自治的主参考。
