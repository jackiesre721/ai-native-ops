# 附录B 企业双原生架构综合实战与五大故障闭环案例
<!-- 附录 ｜ 案例锁死·全覆盖无新增（仅复用正文知识落地验证） ｜ 状态：终审中 -->

> 案例永久锁死 5 个，不再增减，全覆盖全书核心主线——五案例分别覆盖 L1 机械自治失效、L2 告警/SLO、云集成、AI 算力、AI 推理性能；第 6 项为五案例×治理域汇总与全链路落地复盘，串联全书完整运维控制闭环。仅复用正文知识点落地验证，无任何新技术、新架构引入。每个案例统一复盘格式：**背景 → 时间线（HH:MM 精确到分钟）→ 排障实录（实际命令）→ 根因（含 13.3 根因五问中最重的两问）→ 处置与止损 → 长效整改（锚回正文章节）**；复盘五字段与根因五问的完整定义见 13.3，此处只引用不重复。案例环境均为 ACK 生产集群（对照 EKS），工具只用正文锁死栈：kubectl、aliyun CLI、ArgoCD/Rollouts、KEDA、vLLM/DCGM、vmalert/Alertmanager。

---

## B.1 案例一：节点压力驱逐撞上慢自愈参数——L1 闭环在干活，但每次要 210 秒
<!-- 覆盖：L1 机械自治失效 ｜ 锚点：5.3 / 6.4 / 7.1 / 7.4 / 4.2 / 13.5 -->

**背景**：ACK Pro 生产集群（通用节点池、多可用区），支付链路 demo-api 4 副本。该服务沿用旧交付模板：容器未设 memory limit、无 PDB、镜像公网拉取、readiness 靠 initialDelaySeconds 硬等 120s、无 startupProbe。凌晨一台节点内存水位越限，kubelet 触发节点压力驱逐。

**时间线**（定级 P1；SLO 99.9% → 错误预算 43.2 分钟/30 天；影响 23 分钟、消耗 ≈1.4 分钟/月预算的 3.2%）：

| 时刻 | 事件 | 依据/动作 |
|---|---|---|
| 02:03 | 节点 MemoryPressure，kubelet 驱逐 11 个 Pod（含 demo-api 2 副本），无 PDB 阻拦 | events: Evicted |
| 02:06 | ErrorBudgetBurnFast（P0 电话，错误率 6% > 14.4×0.1%）与 PodHighRestart 同步触发 | vmalert 双窗口 |
| 02:09 | 值班认领（4 分钟）；按分级矩阵核对：成功率 94% 未到 <50% 红线，按 P1 档投入资源 | 13.3 矩阵 |
| 02:14 | 定位完成：重调度 Pod 公网拉镜像 60s + readiness 硬等 120s 迟迟不就绪，剩余 2 副本过载连锁重启 | 排障实录 ③ |
| 02:17 | 止损：手动扩容 4→8 副本（应急白名单内 ≤2×），全部落到健康节点 | 13.3 SOP |
| 02:26 | 恢复：成功率回 99.9%+、SLO 回归确认 | Grafana 预算看板 |

**排障实录**（实际命令序列，含关键输出要点）：

```bash
# ① 驱逐现场（6.4：第一步永远是抄 events 原文）
kubectl -n prod get pods -o wide                               # READY 列 0/1、2/4 一眼可见
kubectl -n prod get events --sort-by=.lastTimestamp | grep -E 'Evicted|FailedScheduling'
kubectl describe node <node> | grep -A8 'Conditions:'          # ② 节点面：MemoryPressure=True
# ③ 重调度 Pod 为何 3 分钟不就绪（7.1 三步定层）
kubectl -n prod describe pod demo-api-5d8c-abc | sed -n '/Events:/,$p'   # Pulling：公网拉镜像耗时 60s
kubectl -n prod logs demo-api-5d8c-abc --previous --tail=50              # 剩余副本过载重启的第一现场
kubectl -n prod get pdb                                       # ④ 容错护栏核对：返回空——无 PDB（5.3）
# ⑤ 复盘期按 13.5 口径混沌注入实测：旧参数"杀 Pod"自愈 210s（公网镜像 60s+硬等 120s+检测 30s），调优后 47s
```

**根因**：把节点推向临界的是 noisy neighbor 未设 limit（7.4/6.2），把"一次驱逐"放大成"23 分钟 P1"的是自愈参数从未实测——公网镜像、readiness 硬等、无 PDB 三项旧债叠加，L1 闭环"活着但很慢"（7.1 自愈时长预算表）。五问取最重两问：**为什么会坏**——资源治理缺位，节点长期高水位无预警；**为什么恢复用了这么久**——自愈时长从未按 13.5 实测，副本折半时 210s 的自愈等价于不可用。

**处置与止损**：扩容 4→8 副本到健康节点（白名单内，2h 回写 Git）；高水位节点排空后交节点池自动修复替换（4.2）。

**长效整改**（锚回正文）：

- 全容器 request/limit + LimitRange 兜底（7.4/6.2），节点内存水位告警线先于驱逐线。
- 关键服务 PDB 保底（minAvailable 4/5，5.3），驱逐与滚动不再打穿可用副本。
- 探针三件套 + ACR VPC 内网拉镜像进基础 chart 默认值（7.1/第 9 章）；慢启动服务强制 startupProbe（预算 ≥ 最长启动时间 ×1.2）。
- 每月混沌实测自愈 ≤60s 并记台账（13.5）——本次 210s 是"从未实测"的直接代价。

---

## B.2 案例二：500 条告警淹没真 P0——错误发布漏报 40 分钟
<!-- 覆盖：L2 告警/SLO ｜ 锚点：13.1 / 13.2 / 13.3 / 11.2 / 11.3 / 10.4 -->

**背景**：该团队日告警 500+ 条（无分级路由、无收敛、无降噪），P0 与 P3 同刷一个 IM 群。某日下午一次 values 误改（资源配置错）未经评审合并，ArgoCD auto-sync 全量发布（无金丝雀），网关 5xx 飙升。

**时间线**（定级 P0；SLO 99.9% → 预算 43.2 分钟/30 天；影响 56 分钟、消耗 ≈30.8 分钟/月预算的 71%）：

| 时刻 | 事件 | 依据/动作 |
|---|---|---|
| 14:20 | values 误改合并，auto-sync 全量发布 api-gateway | Git 提交记录 |
| 14:23 | 成功率跌至 45%，ErrorBudgetBurnFast 触发——淹没在当日第 400+ 条告警里被值班划掉 | 告警审计 |
| 15:03 | 客服投诉涌入，值班从投诉倒查故障——发现延误 40 分钟 | 用户侧发现 |
| 15:06 | 认领（距告警 43 分钟，P0 5 分钟时限严重违反），开战争室 | 13.3 矩阵 |
| 15:08 | argocd app history 确认 14:20 有部署——最大嫌疑永远是变更 | 13.3 SOP |
| 15:10 | rollback 回退上一版本（暂停 auto-sync）；15:16 恢复，SLO 回归 | 预算看板 |

**排障实录**（实际命令序列，含关键输出要点）：

```bash
# ① 止损优先（13.3 SOP 卡片：每步 ≤3 分钟，先查变更）
argocd app history api-gateway                  # 14:20 有新 revision——变更嫌疑第一
argocd app rollback api-gateway <prev-rev>      # 回退；暂停 auto-sync 防 Git 又同步回来
kubectl get hpa -n prod                          # ② 排除容量分支：副本与负载正常——非容量问题
kubectl get pods -A | grep alertmanager          # ③ 告警链路核对：Alertmanager 本身正常
#    根因在路由配置：无 severity 分级，P0 与 P3 同 receiver 同群刷屏（13.1 反面配置）
# ④ 证据固化：当日已触发告警 500+、单人划掉 95%；误改 commit 与回退记录归档进故障台账（13.4）
git revert <误改-commit>                          # 2h 内应急回写 Git，标注"应急回写"
```

**根因**：根因不在发布本身，而在两道防线同时缺位——变更无灰度护栏（全量直达用户，11.2 本可在 10% 流量阶段拦截），告警无标准化治理（P0 电话路由缺失，真信号被噪音淹没）。五问取最重两问：**为什么没被拦截**——prod 变更未走金丝雀与自动回滚（11.2/11.3）；**为什么没早点发现**——500+ 条/日的告警背景噪音里，值班对第 400 条之后的告警早已脱敏（13.1 告警疲劳）。

**处置与止损**：rollback 止血（认领后 4 分钟完成）；2h 内 revert 回写 Git 并提复盘（13.3 应急回写制度）。

**长效整改**（锚回正文）：

- 告警五环节落地（13.1）：group_by 收敛 + for 降噪 + inhibit 抑制 + P0 电话 0 等待；三个月后日告警 500+ → ≤20 条，真故障 5 分钟内认领。
- prod 变更全量走 Argo Rollouts 金丝雀 + 指标异常自动回滚（11.2/11.3）——同类误改在 10% 流量即被熔断。
- values/MR 强制评审 + 分支保护（10.4）。
- 错误预算四档接发布流程（13.2）：本次剩余 28.7%，一周内仅允许低风险变更、灰度比例减半。

---

## B.3 案例三：FinOps 巡检误删生产 SLB——入口全断，靠声明式闭环重建
<!-- 覆盖：云集成（SLB/CCM） ｜ 锚点：4.2 / 8.2 / 13.4 / 14.3 / 5.2 -->

**背景**：ACK 生产，入口 Service（type: LoadBalancer）由 CCM 自动创建的 SLB 承载全站流量。周五 FinOps 闲置回收巡检（14.3），巡检人把一个"云监控无流量"的 SLB 判为闲置，直接在控制台删除——删除保护注解未开、删除属授权白名单外操作未走审批；而 K8s 侧可观测看不到云 LB 层流量，两侧信息都不完整。

**时间线**（定级 P0；SLO 99.9% → 预算 43.2 分钟/30 天；影响 24 分钟、消耗 24 分钟/月预算的 55.6%）：

| 时刻 | 事件 | 依据/动作 |
|---|---|---|
| 10:31 | 巡检人员控制台删除 SLB（无删除保护） | 云操作记录 |
| 10:33 | 全站入口 5xx 100%，ErrorBudgetBurnFast P0 电话触发——告警先于投诉 | 13.2 双窗口 |
| 10:36 | 值班认领（3 分钟，P0 5 分钟时限内），开战争室 | 13.3 矩阵 |
| 10:38 | 定位：副本全部 Running、svc Events 见 CCM Reconcile 报错、云侧查实例为空 | 排障实录 |
| 10:40 | 止损决策：Git 中 Service 清单未变（真相源完整）→ 交回 CCM 调谐重建 SLB | 5.2/4.2 |
| 10:48 | CCM 按注解规格重建 slb.s2.small，后端挂载恢复，Service status 回写新地址 | svc Events |
| 10:55 | 入口域名解析更新生效（TTL 300s），恢复；SLO 回归确认 | 预算看板 |

**排障实录**（实际命令序列，含关键输出要点）：

```bash
kubectl -n prod get pods -l app=demo-api -o wide               # ① 分层排除：副本全部 Running——故障不在 L1
kubectl -n prod describe svc demo-api | sed -n '/Events:/,$p'  # CCM 回写报错：Reconcile 失败
# ② CCM 排障路径（4.2）
kubectl -n kube-system get pods | grep -E 'ccm|alb'
kubectl -n kube-system logs deploy/ccm --tail=50               # 关键输出：SLB 实例不存在/查询返回空
# ③ 云侧确认（aliyun CLI；对照 aws elb describe-load-balancers）
aliyun slb DescribeLoadBalancers --RegionId cn-hangzhou \
  | jq '.LoadBalancers.LoadBalancer[] | select(.LoadBalancerName|contains("demo-api"))'   # 输出空——实例已被删
# ④ 真相源核对：Git 无变更、集群内 Service 清单完整 → 走声明式重建，不手工建 LB
```

**根因**：根因不在 CCM 或 K8s，而在云集成层的治理缺位——删除保护注解未开（4.2 防误删三件套缺位）、"删资源"白名单外操作未走审批（13.4）、SLB 无 team/env/cost-center 标签（14.3），巡检无从识别"这是生产入口"。五问取最重两问：**为什么没被拦截**——删除动作绕过授权白名单，且删除保护这道云侧最后防线没开；**同类风险还有哪里**——云盘、NAS、快照同样游离在 K8s 观测之外，凡无台账归属的云资源都是下一颗雷。

**处置与止损**：交回声明式闭环——Service 期望状态完整，等 CCM 调谐重建 SLB（5.2），域名解析切换后流量恢复；2h 内把 delete-protection 注解补进 Git。

**长效整改**（锚回正文）：

- SLB delete-protection 注解进基础 chart 默认值（4.2/第 9 章），存量实例一次性补齐。
- 删资源/安全组/存储类操作一律升级审批——授权白名单的反面清单（13.4）。
- 云资源三标签（team/env/cost-center）打齐（14.3）：巡检可识别归属，消灭"无主资源"。
- CCM 排障路径（svc Events + ccm logs + aliyun CLI）进值班手册与 SOP 卡片（4.2/13.3）。

---

## B.4 案例四：Spot 批量回收打爆 vLLM 推理——KEDA 拉起撞上节点弹性瓶颈
<!-- 覆盖：AI 算力（GPU/抢占式） ｜ 锚点：14.3 / 17.4 / 18.7 / 16.3 / 4.2 -->

**背景**：llm-prod 的 vllm-qwen7b（Qwen2.5-7B @ A10，按量 ¥5–10/时/张）为压成本整体放进 Spot 节点池（6 台 gn7i，省 50%+），KEDA 排队信号驱动 2–8 副本（18.7）。周一晚供需波动，云侧一次性回收 3 台。

**时间线**（定级 P1：TTFT p99 3.2s 超 SLO(1s) 3 倍；可用性 99.5% 内部档 → 预算 216 分钟/30 天；容量受损 27 分钟、消耗 ≈2.4 分钟/月预算的 1.1%）：

| 时刻 | 事件 | 依据/动作 |
|---|---|---|
| 21:47 | Spot 释放通知（提前约 5 分钟，系统事件+元数据），3/6 台同时命中 | 14.3 通知语义 |
| 21:48 | 事件驱动排水：cordon + drain（grace 60s，14.3 准入三件套） | 排水脚本 |
| 21:52 | 3 节点排空，vLLM 副本 2→1；单副本 MTTR ≈ 节点替换 + 模型加载 5–8 分钟 | 17.4 |
| 21:55 | TTFT p99 破 3s、排队持续 >0——18.5 三条基线告警 P1 触发 | vmalert |
| 21:58 | 值班认领（P1 10 分钟时限内） | 13.3 |
| 22:01 | 定位：排队 120+，KEDA 已扩到 maxReplicaCount 8，新副本 Pending——节点弹性补机 3–5 分钟且仍落 Spot 池 | 排障实录 |
| 22:03 | 第二批释放通知（新补 Spot 节点再被回收）——震荡坐实根因 | 元数据 |
| 22:06 | 止损：minReplicaCount 2→4 并以 nodeSelector 固定到常规 GPU 节点池，手动扩常规池 | 18.7 |
| 22:19 | 恢复：TTFT p99 回 1s 内；最深可用性 91%，SLO 回归 | 预算看板 |

**排障实录**（实际命令序列，含关键输出要点）：

```bash
# ① Spot 中断现场（14.3 元数据口径；返回非空 = 约 5 分钟后释放）
curl -s -m 2 http://100.100.100.200/latest/meta-data/instance/spot/termination-time
kubectl -n llm-prod get pods -o wide                            # ② 副本与调度面：1 个 Running + 多个 Pending
kubectl -n llm-prod describe pod vllm-qwen7b-7f9d-xyz | sed -n '/Events:/,$p'   # FailedScheduling: insufficient nvidia.com/gpu（4.3 判定表）
# ③ 排队信号（18.5 指标，Prometheus 兼容 API）
curl -sG 'http://vmsingle-vm.monitoring.svc:8428/api/v1/query' \
  --data-urlencode 'query=sum(vllm:num_requests_waiting{namespace="llm-prod"})'   # 120+
# ④ 弹性现场：期望已拉满、就绪没跟上
kubectl -n llm-prod get scaledobject                            # SCALE 列钉在 8/8
kubectl -n llm-prod get deploy vllm-qwen7b -o jsonpath='{.status.readyReplicas}/{.status.replicas}'   # 1/8
```

**根因**：根因是负载与 Spot 特性错配（14.3：AI 推理慎用）——Spot 的经济性前提是"中断 = 驱逐重建、秒级恢复"，而推理副本中断代价 = 模型加载分钟级（17.4）；5 分钟通知窗内排水没问题，排水之后的容量恢复链（节点弹性 3–5 分钟 + 模型加载 1–3 分钟，18.7）远超通知窗，且弹性补机仍落 Spot 池，形成二次回收震荡。五问取最重两问：**为什么会坏**——省 50% 成本的决策没对照 14.3 的负载-Spot 匹配表；**为什么恢复用了这么久**——KEDA 天花板有了，但"常规池基线副本"缺位，扩容全部挤在同一个 Spot 池的节点弹性瓶颈上。

**处置与止损**：基线副本固定常规 GPU 池 + 手动扩常规池节点；2h 内回写 Git（ScaledObject min/max 与 nodeSelector）。

**长效整改**（锚回正文）：

- 推理常驻副本迁常规 GPU 节点池（包月），Spot 只承接批处理/基准流量等可重算负载（14.3 匹配表、18.3）。
- KEDA minReplicaCount 落常规池、Spot 只做溢出副本；缩容冷却 ≥ 模型加载时长（18.7/16.3）。
- Spot 准入三件套补齐：污点容忍 + 短排水 + 中断事件监听（14.3）。
- 扩容总时延（节点 3–5 分钟 + 加载 1–3 分钟）纳入容量冗余设计（18.7 的 ×1.3 冗余）。

---

## B.5 案例五：长上下文突发引爆 KV 抢占——TPOT 飙升十倍
<!-- 覆盖：AI 推理性能（KV/排队） ｜ 锚点：18.2 / 18.3 / 18.4 / 18.5 / 18.6 / 18.7 -->

**背景**：prod 的 vllm-llm7b（Qwen2.5-7B GQA @ A10）上线时 --max-num-seqs 用了默认 256，未做显存拆账（KV 实际只够 ≈28 路，18.2）；KEDA 排队信号驱动 2–8 副本。周一上午文档摘要功能全量放量，平均输入从 ≈1K tokens 跳到 4K+。

**时间线**（定级 P1；TTFT p99 <1s / TPOT p99 <100ms（18.6）；可用性 99.9% → 预算 43.2 分钟/30 天；影响 27 分钟、消耗 ≈0.6 分钟/月预算的 1.4%）：

| 时刻 | 事件 | 依据/动作 |
|---|---|---|
| 10:12 | 文档摘要放量：平均输入 1K→4K+ tokens，长请求入批 | 网关日志 |
| 10:17 | vllm:gpu_cache_usage_perc >0.90 持续 5 分钟——18.5 基线告警 P1 触发 | vmalert |
| 10:20 | 值班认领（P1 10 分钟时限内） | 13.3 |
| 10:24 | 定位：num_preemptions 5 分钟 +400、TPOT p99 30ms→300ms 量级、排队持续 >0——18.3 模型归因到 KV 段抢占 | 排障实录 |
| 10:27 | 止损：入口网关按 18.4 容量上限限流（并发减半）+ KEDA 排队信号自动扩至 6 副本 | 18.6/18.7 |
| 10:35 | 显存拆账反推 --max-num-seqs 24，先灰度单副本生效；抢占归零 | 18.2 |
| 10:44 | 恢复：TPOT p99 回 30ms 量级、TTFT <1s；SLO 回归确认 | 预算看板 |

**排障实录**（实际命令序列，含关键输出要点）：

```bash
# ① KV 段三指标（18.2 判读口径；/metrics 为 vLLM 官方端点）
kubectl -n prod exec deploy/vllm-llm7b -- curl -s localhost:8000/metrics \
  | grep -E 'num_preemptions|gpu_cache_usage_perc|num_requests_(running|waiting)'
#   输出要点：num_preemptions 5m 增量 412（>0 即异常）；gpu_cache_usage_perc 0.95；waiting 34
curl -sG 'http://vmsingle-vm.monitoring.svc:8428/api/v1/query' --data-urlencode \
  'query=histogram_quantile(0.99, sum by (le)(rate(vllm:time_per_output_token_seconds_bucket[5m])))'   # ② TPOT p99=0.29s > SLO 0.1s（18.5 同式）
# ③ 并发上限核对（根因坐实：默认 256 vs KV 只够 28 路）
kubectl -n prod get deploy vllm-llm7b -o jsonpath='{.spec.template.spec.containers[0].args}' | tr ' ' '\n' | grep -c max-num-seqs   # 0=未显式配置
# ④ 前缀缓存核对（多轮/共享模板场景命中率应 ≥50%）
kubectl -n prod exec deploy/vllm-llm7b -- curl -s localhost:8000/metrics | grep -i prefix_cache       # 无输出=未开启
```

**根因**：用 18.3 模型归因：QPS 稳定、GPU 利用率高、TPOT 飙升 → Decode 段 → 批内长请求 + KV 抢占——`--max-num-seqs` 默认 256 放行远超 KV 容量（28 路）的并发，调度器不停"抢占换出→重算"（18.2：延迟雪崩头号人为根因）；长上下文突发再把单请求 KV 占用放大 4 倍，雪崩提前引爆。五问取最重两问：**为什么会坏**——新模型/新功能上线未做显存拆账，并发上限不是拆账反推的；**为什么没早点发现**——KV 水位告警本次先于用户感知（防线有效），但 max-num-seqs 无上线准入校验，风险在发布前就已存在。

**处置与止损**：入口限流（并发减半）先压住抢占；--max-num-seqs 24 单副本灰度验证后全量，并开 --enable-prefix-caching。

**长效整改**（锚回正文）：

- 显存拆账成为新模型/新功能上线必做算例，--max-num-seqs 由拆账反推、禁默认值上线；num_preemptions 增量 >0 一票否决发布（18.2）。
- 入口限流按 18.4 容量模型设并发上限——防过载引发 KV 抢占雪崩（18.6 容错三件套）。
- 长上下文流量分桶隔离，独立实例组承接（3.3 长尾隔离）。
- KEDA 排队信号 + 慢缩容 + 天花板常开（18.7）；前缀缓存命中率进面板（多轮场景 ≥50% 基线，18.2）。

---

## B.6 五案例×治理域汇总与全链路落地复盘
<!-- 串联全书完整运维控制闭环 -->

| 案例 | 所属自治层/治理域 | 暴露的体系短板 | 整改锚点章节 |
|---|---|---|---|
| B.1 驱逐×慢自愈 | L1 机械自治 | 自愈参数从未实测；limit/PDB 缺位 | 5.3、6.4、7.1、7.4、13.5 |
| B.2 告警淹没真 P0 | L2 告警/SLO | 告警未标准化；变更无灰度护栏 | 13.1–13.3、11.2/11.3、10.4 |
| B.3 SLB 误删 | 云集成（L1 声明式恢复兜底） | 删除保护缺位；白名单外操作；云资源无台账 | 4.2、8.2、13.4、14.3 |
| B.4 Spot 打爆推理 | AI 算力（L2 弹性） | 负载与 Spot 特性错配；扩容时延未入容量 | 14.3、16.3、17.4、18.7 |
| B.5 KV 抢占风暴 | AI 推理性能（L3 决策输入） | 并发上限未对齐 KV 容量；无限流护栏 | 18.2–18.7 |

全链路收束：五个案例的止损动作无一例外回到同两件事——**声明式真相源**（Git 期望状态 + 控制器/CCM/KEDA 的调谐闭环负责收敛）与 **SLO 口径**（预算消耗决定止损节奏与发布档位）。这正是全书核心业务闭环链路（不可变基础设施→K8s 底座→声明式→GitOps→灰度→OTel 可观测→SRE 治理→平台封装→运维自治→AI 算力→推理性能→KV 缓存→AI 智能自治）在故障场景下的重演：B.1/B.3 验证 L1 机械自治（第 5 章）的可靠性与边界，B.2/B.4 验证 L2 运维自治（第 16 章）的触发信号与处置质量，B.5 验证 L3 智能自治（第 18 章）的输入指标与决策依据。每个案例复盘出的根因模式（自愈未实测、告警未治理、云资源无台账、Spot 错配、并发未拆账）最终都反哺为正文对应章节的准入项、告警规则与自治输入——三层递进自治模型由此在一家企业完整跑通：它是可落地的工程体系，而非理论。
