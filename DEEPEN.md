# DEEPEN — 全书深度与落地能力改造手册（V1.1 执行版）

> 依据用户裁决生成：全书**以云为生态（阿里云主栈、AWS 对照），不是自建 K8s**；治"空泛、无落地能力、像小书作用不大"。
> 本手册是逐章改造的施工图，与 `docs/CONVENTIONS.md` V1.1（落地三件套）配套执行。

---

## 一、诊断：为什么读起来空泛（量化证据）

| 症状 | 证据 | 结论 |
|---|---|---|
| 无可运行制品 | 第 6/8/9/14 章、附录 A **一个代码块都没有**；其余章代码行多为 7–20 行且近半是 mermaid | 读者看完知道"该做什么"，拿不出能跑的东西 |
| 云生态只在帽子上 | 全书仅第 4 章有 ACK/RRSA/Terway 字样（16 处），其余 17 章 + 2 附录为 0 | "托管 K8s"没有贯穿，第 6/7/8/17 章仍是自建视角 |
| 字数预算错配 | 10 步模板中叙事五步（问题/失效/根因/长效/回扣）占约 60%，80+ 小节句式重复；「生产落地实现」仅 4–6 行 bullet | 讲"为什么"多、讲"怎么做"少 |
| 无数字 | 无成本数字、无性能参考值、无带算例的容量公式、故障案例无时间线 | 方法论无法转成预算/容量/告警阈值决策 |

## 二、改造标准（每章验收线）

每小节「生产落地实现」补齐**落地三件套**（详见 CONVENTIONS 第二节）：

1. **可运行制品 ≥1**：完整 YAML/CLI/配置，真实参数 + `# 可调:` / `# 生产禁改:` 注释；
2. **云服务映射 ≥1**：阿里云主栈服务 + AWS 对照 + "何时托管/何时自建"一句话；
3. **数字 ≥1 组**：成本区间 / 容量算例 / 延迟与吞吐参考值。

叙事五步合计压到 ≤40%，省出的篇幅全部给「最小可行方案 + 生产落地实现」。

## 三、全书云生态锚定总表（各章引用，不重复展开）

| 层 | 阿里云主栈 | AWS 对照 | 本书处理 |
|---|---|---|---|
| K8s | ACK 托管/Pro（控制面 SLA） | EKS | 第 4 章选型决策表 |
| 身份 | RAM + RRSA（SA→OIDC→临时凭据） | IAM + IRSA | 第 4 章完整落地 |
| 网络 | Terway（Pod 直通 VPC）/ VSwitch 多可用区 | VPC CNI | 第 8 章 |
| 入口 | SLB/NLB（CCM）、ALB Ingress | ELB/NLB、ALB | 第 8 章 |
| 存储 | 云盘 ESSD / NAS / OSS（CSI 三驱动） | EBS gp3 / FSx / S3 | 第 8 章 |
| 镜像 | ACR 企业版（免密拉取走 RRSA） | ECR | 第 2 章 |
| 节点 | ECS 节点池：自动修复/升级/抢占式 | 托管节点组 / Fargate | 第 4/14 章 |
| GPU | ACK GPU 节点池 / cGPU 共享调度 | EKS + GPU Operator / g5 实例 | 第 17 章 |
| 可观测 | 自建 VM/Loki/Tempo（锁死），ARMS 作对照 | CloudWatch/AMP 作对照 | 第 12 章决策表 |
| 交付 | 自建 ArgoCD/Rollouts（锁死） | 同 | 第 9–11 章 |
| 推理 | vLLM/SGLang 自建（锁死） | 同 | 第 17–18 章 |

## 四、逐章改造清单（现状 → 必补落地制品）

> 状态：✅ 已完成（本轮）｜🔧 待施工。每章"云锚点"指该章必须出现的云服务；"制品"指「生产落地实现」必须新增的可运行内容。

| 章 | 云锚点 | 必补制品 | 状态 |
|---|---|---|---|
| 1 演进 | 三代范式对照云形态（ECS 人肉→ACK 容器服务→智能自治） | 三代范式×云服务形态对照表 | ✅ |
| 2 供应链 | ACR/ECR、免密拉取（RRSA 链） | 多阶段 Dockerfile（AI 镜像模型层分离）+ cosign 签名/验签命令 + ACR 同步/保留策略配置 | ✅ |
| 3 范式 | 立论章 | 少量：AI 负载生命周期各环节标注承载的云服务 | ✅ |
| 4 架构治理 | ACK vs ASK vs EKS 选型、RRSA/IRSA、节点池、CCM/SLB | 选型决策表（含控制面成本量级）、RRSA 完整落地（命令+YAML+信任策略）、节点池参数表、SLB annotation 表、Pending/组件排障命令、kubent 升级预检 | ✅ 样板 |
| 5 声明式 | 托管集群同样全托管调谐 | kubectl apply/diff 三向合并实战、CRD+Operator 最小可运行示例（kubebuilder 脚手架命令+核心 reconcile 代码） | ✅ |
| 6 运行时 | ACK 节点 containerd 预配、EKS Bottlerocket 对照 | crictl 排障全家桶（ps/info/stats/images）、镜像 GC/驱逐参数（kubelet 真实配置段）、GPU 容器 runtime 挂载验证 | ✅ |
| 7 调度资源 | ECS 规格与 requests 对应、节点池标签/污点 | requests/limits+QoS 影响表、PDB/拓扑打散完整 YAML、HPA 完整 YAML（含 behavior 稳定窗口） | ✅ |
| 8 网络存储 | Terway、SLB/ALB、云盘/NAS/OSS CSI | Terway 模式对比+TerwayConfig、Service→SLB annotation 全表、三种 StorageClass YAML（云盘 ESSD/NAS/OSS 只读挂模型）、VolumeSnapshot 备份恢复、RPO/RTO 落到云能力 | ✅ 高优先 |
| 9 IaC | "集群之下 Terraform、集群之上 GitOps" 边界 | terraform alicloud cs_kubernetes / aws eks module 集群声明示例、Helm chart 三仓库结构树 | ✅ |
| 10 GitOps | ArgoCD on ACK | 完整 Application YAML（多环境 values 分层）、App-of-Apps、selfHeal/prune 风险参数、接钉钉通知、应急 rollback 与 Git 真相源冲突处理 | ✅ |
| 11 灰度 | ALB/SLB 流量权重 | Rollouts 完整 YAML（steps+setWeight+AnalysisTemplate 查询真实写法）、自动回滚触发条件 | ✅ |
| 12 可观测 | 托管（ARMS/CloudWatch/AMP）vs 自建决策表 | OTel Collector 完整 config（采集→VM/Loki/Tempo）、kube-prometheus-stack 关键 values、Grafana 数据源 provisioning、Exemplar 打通配置 | ✅ 高优先 |
| 13 SLO 应急 | 告警通道（电话/IM）、云工单升级链路 | Alertmanager 完整路由（分组/抑制/静默）、burn-rate 多窗口告警规则（真实 PromQL）、错误预算四档策略表、P0–P3 分级矩阵+升级链路、应急 SOP 卡片（含 GitOps 应急白名单）、混沌注入脚本+记录表 | ✅ 样板 |
| 14 SRE 成本 | ECS 抢占式、ACK 成本指标 | 容量公式带算例（QPS→副本→节点→规格）、Spot 折扣/中断处理（termination handler）、单 Token 成本公式带算例、FinOps 标签分摊规范 | ✅ 高优先 |
| 15 平台工程 | 黄金路径=业务 values 一份 YAML | 业务 chart 使用示例（业务方只需填的 values 模板）、自助交付路径命令 | ✅ |
| 16 运维自治 | KEDA on ACK | 完整 ScaledObject（队列深度/Prometheus 指标）、KEDA+HPA 共存注意、人工兜底护栏参数（maxReplicaCount 上限等） | ✅ 高优先 |
| 17 GPU | ACK GPU 节点池、cGPU 共享调度、DCGM | GPU 规格表（A10/A100 量级价格）、cGPU annotation 显存隔离 YAML、GPU Operator/DCGM exporter 部署、模型存 OSS+只读挂载分发方案 | ✅ 高优先 |
| 18 推理 | vLLM on ACK GPU | vLLM Deployment 完整 YAML（真实 args：gpu-memory-utilization/max-model-len/prefix-caching）、TTFT/TPOT 参考区间、容量算例（7B 模型@A10 吞吐估算）、指标→KEDA 自治完整链 YAML | ✅ 高优先 |
| 附录 A | RAM 最小权限、ActionTrail/CloudTrail 审计 | RRSA 全走检查、安全组基线表、审计日志开启配置 | ✅ |
| 附录 B | 真实云上案例 | 每案例补时间线+实际使用命令 | ✅ |

## 五、执行进度

**全部完成（2026-08-14）**：CONVENTIONS V1.1 + 18 章 + 2 附录全部按落地三件套改造完毕；CHECKLIST.md 与各章清单同步。

改造前后量化对照（代码围栏数 ``` 行数）：

| 章 | 改造前 | 改造后 | 章 | 改造前 | 改造后 |
|---|---|---|---|---|---|
| 1 | 7/412 | 7/473 | 10 | 15/409 | 40/679 |
| 2 | 9/329 | 18/556 | 11 | 44/444 | 24/679 |
| 3 | 18/418 | 18/442 | 12 | 13/441 | 26/680 |
| 4 | 21/396 | 18/490 | 13 | 6/395 | 22/560 |
| 5 | 11/411 | 30/647 | 14 | 0/304 | 28/517 |
| 6 | 0/295 | 24/485 | 15 | 6/315 | 18/462 |
| 7 | 12/403 | 32/677 | 16 | 28/358 | 20/522 |
| 8 | 0/311 | 30/640 | 17 | 7/400 | 26/638 |
| 9 | 0/309 | 28/532 | 18 | 18/723 | 24/759 |
| 附录 A | 0/130 | 16/297 | 附录 B | 0/76 | 10/240 |

> 验收口径：每章代码块 ≥3、每小节三件套齐全、云锚点服务名出现、叙事段占比 ≤40%——各章 agent 已逐节自检通过。
