# 第6章 Kubernetes资源与精细化调度治理
<!-- 第二篇 Kubernetes 底座 ｜ 常规章（原生弹性痛点·与第15章 KEDA 严格解耦） ｜ 状态：终审中 -->

> 本章定位：聚焦 K8s 原生调度与弹性痛点。6.5 小节直击「CPU 指标正常但业务请求排队、负载异常」核心问题，并与第 15 章 KEDA 分层解耦（本章讲原生缺陷，第 15 章讲平台补齐）。落地环境为托管 K8s——ACK 主参考（EKS 对照），节点 = ECS 节点池（4.2），调度与配额约束全部落到节点池标签、污点、多可用区与团队 namespace 上。
> **主线定位**：本章为调度与资源是 L1 收敛的物理落点——副本、驱逐与弹性都在此兑现（三层自治见 1.5；L3 = 运维 Agent 引擎，15.4⑤/15.5）。 **主旨绑定**：AI 原生运维的第一道原生短板在此暴露——HPA 不懂业务信号（15.3 KEDA 收口）；主旨的演进正从原生短板起步。 **承上启下**：承第 4–5 章（底座与调谐闭环既立，期望状态靠资源与调度兑现）；启第 7 章网络与存储（补齐连接与供给面）——原生弹性短板由 15.3 KEDA 远期收口。

---

## 6.1 Pod生命周期、三大探针机制与异常重启、崩溃根因定位

### 生产问题

服务频繁重启，CrashLoopBackOff 闪个不停，但没人说得清为什么：是程序崩了、是探针太严、是依赖没起、还是资源不够。**Pod 异常重启是最常见的生产故障，且自愈速度直接由探针与镜像参数决定**——12.5 的混沌实测里，同一套"杀 Pod"注入，参数不同，恢复耗时 210s 与 47s 相差 4.5 倍。没有探针与生命周期视角，排查只能在日志里大海捞针。

### 传统方案失效原因

- **探针缺失或乱配**：没探针（崩了不知道）、太严（健康也杀）、太松（死了不重启）；liveness/readiness/startup 职责混用——该摘流量的去重启、该重启的在摘流量。
- **崩溃根因不分层**：代码 bug、依赖缺失、OOM、探针配错都表现为"在重启"，不分类只能挨个猜。

失效根因：**把探针当可选项、把生命周期当黑盒**——探针是 Pod 可靠性的主动防线，不用好就是被动救火。

### 架构约束与权衡

三大探针的职责分工：

| 探针 | 职责 | 触发动作 | 误配后果 |
|---|---|---|---|
| **liveness** | 容器死活 | 失败 → 重启容器 | 太严：健康也重启；太松：死了不重启 |
| **readiness** | 能否接流量 | 失败 → 摘出 Service（不重启） | 太严：正常也被摘流量 |
| **startup** | 慢启动保护 | 成功前 liveness 暂停 | 缺失：慢启动服务被 liveness 误杀 |

全部时间参数与官方默认值（字段语义以官方文档为准）：initialDelaySeconds=0、periodSeconds=10、timeoutSeconds=1、successThreshold=1、failureThreshold=3；liveness/startup 的 successThreshold 只允许为 1；检测时长 = failureThreshold × periodSeconds（默认 30s——约一次深呼吸的时长，这就是多数集群默认的自愈检测窗）；timeoutSeconds 默认 1s 对 Java/慢接口几乎必误判，生产给 3–5s。

两个关键语义：**startupProbe 成功之前 liveness 探针暂停**（慢启动服务的官方保护机制）；容器崩溃后 kubelet 按 10s→20s→40s 指数退避重启、上限 5 分钟——这就是 CrashLoopBackOff 的节奏。

权衡的核心：**探针是"健康判定"的工程化**——liveness 管"死活"，readiness 管"可用"，startup 管"启动保护"；检测越快越灵敏，但太灵敏会把瞬时抖动当故障。

### 最小可行方案

1. **三探针齐全**：liveness（重启）+ readiness（流量）+ startup（慢启动服务必配）。
2. **启动预算公式**：`startup 预算 = periodSeconds × failureThreshold ≥ 真实最长启动时间 × 1.2`。
3. **崩溃分层排查**：describe（状态/Exit Code）→ logs --previous（上次崩溃现场）→ events（探针/OOM/调度）。

### 生产落地实现

**① 三探针完整配置**（在线服务标准模板，沉淀进基础 chart，第 8 章；resources 见 6.4）：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: demo-api, namespace: prod }
spec:
  replicas: 4
  selector: { matchLabels: { app: demo-api } }
  template:
    metadata: { labels: { app: demo-api } }
    spec:
      containers:
      - name: api
        image: registry.cn-hangzhou.aliyuncs.com/<ns>/demo-api:1.42.0   # ACR 镜像：tag 不可变，禁 latest
        startupProbe:                             # 慢启动保护：成功前 liveness 暂停
          httpGet: { path: /healthz, port: 8080 }
          initialDelaySeconds: 5                  # 可调：进程开始监听端口的粗略时间
          periodSeconds: 5                        # 可调：5s 探一次
          timeoutSeconds: 3                       # 可调：须 ≥ /healthz 最慢响应
          successThreshold: 1                     # 固定 1：liveness/startup 只允许 1
          failureThreshold: 36                    # 可调：预算 5×36=180s，覆盖 150s 级慢启动
        livenessProbe:                            # 管"死活"：失败 → 重启
          httpGet: { path: /healthz, port: 8080 } # /healthz 只查进程自身，不查下游依赖
          periodSeconds: 10                       # 可调：检测粒度
          timeoutSeconds: 3                       # 可调：默认 1s 对慢接口必误判
          failureThreshold: 3                     # 30s 判死：过滤瞬时抖动
        readinessProbe:                           # 管"能不能接流量"：失败 → 仅摘流量
          httpGet: { path: /ready, port: 8080 }   # /ready 应检查下游依赖（DB/缓存连通）
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3                     # 15s 摘流量：比 liveness 更快摘、更快恢复
          successThreshold: 2                     # 可调：连续 2 次成功才挂回（默认 1）
```

**② 自愈时长预算表**——探针参数不是"配了就行"，每一秒都放大到每次自愈与滚动（数字呼应 12.5 混沌实测）：

| 环节 | 误配旧值 | 调优后 | 可调杠杆 |
|---|---|---|---|
| 故障检测（liveness 失败） | 30s | 30s | failureThreshold × periodSeconds |
| Pod 重建 + 镜像就绪 | 60s（公网拉镜像） | 5s（ACR VPC 内网 + 节点缓存） | ACR 企业版（对照 ECR） |
| 启动 + 就绪判定 | 120s（readiness initialDelaySeconds 硬等） | ≤12s（startup 接管 + readiness 2×5s） | 探针时间参数 |
| **合计（12.5 实测口径）** | **≈210s** | **≈47s** | 同一注入，差 4.5 倍 |

云服务映射：托管集群里"拉镜像"一环有现成优化——ACR 企业版（对照 ECR）同地域 VPC 内网拉取，把公网 30–60s 压到秒级；而 ACK 节点池的自动升级/自动修复（4.2）会常态化 drain 节点，**Pod 重建不是偶发事故而是日常**——探针与镜像的每秒优化，都在放大到每一次滚动与自愈。

**③ CrashLoopBackOff 排障命令序列**（三步定层，顺序固定）：

```bash
# 1) describe：Last State 的 Exit Code（137/OOMKilled=资源）与 Events（探针杀容器/调度失败）
kubectl -n prod describe pod demo-api-5d8c-xyz | grep -A6 "Last State"; kubectl -n prod describe pod demo-api-5d8c-xyz | sed -n '/Events:/,$p'
# 2) logs --previous：看上一次崩溃的现场日志（最关键一步，别只看当前容器——代码异常栈/依赖超时）
kubectl -n prod logs demo-api-5d8c-xyz --previous --tail=100
# 3) events：describe 事件被冲掉时，直接查事件流（--sort-by 按时间排）
kubectl -n prod get events --sort-by=.lastTimestamp | grep demo-api
```

### 典型故障案例

某 Java 服务启动需 90s，liveness `initialDelaySeconds: 60` + `periodSeconds: 10` + `failureThreshold: 3`：60s 后开始探测，第 60/70/80s 连续 3 次失败，约第 80s 杀掉容器——正好卡在启动完成前，无限重启。加 startupProbe（预算 10×30=300s）后 liveness 延后生效，一次启动成功。

点评：**慢启动服务不配 startup 探针，就是给 liveness 递刀**。

### 根因定位

拆到底，是**探针职责不清 + 缺少 startup 保护**——探针误配是 CrashLoopBackOff 的高发根因，却最常被先当成"程序 bug"去翻代码。

### 长效治理方案

- 三探针模板进基础 chart 默认值（第 8 章），慢启动服务强制 startupProbe。
- 启动预算按"真实最长启动时间 × 1.2"设定，依赖变多导致启动变慢时同步调整。
- 每月混沌注入实测自愈时长（12.5），超 60s 开整改单。

### 自动化/自治闭环

探针是 L1 机械自治（第 5 章）的健康信号源——liveness 触发的重启、readiness 触发的摘流量都是自治动作；探针准，自愈才准；探针误配，自愈变自伤。

### 生产检查清单

- [ ] 三探针齐全且职责清晰（liveness 重启 / readiness 摘流量 / startup 保护启动）？
- [ ] 慢启动服务配 startupProbe，预算 ≥ 最长启动时间 × 1.2？
- [ ] timeoutSeconds ≥ 接口最慢响应（不用默认 1s 硬套 Java 服务）？
- [ ] CrashLoopBackOff 按 describe → logs --previous → events 三步分层排查？
- [ ] 自愈时长经混沌实测 ≤60s，镜像走 ACR VPC 内网拉取？

---

## 6.2 核心控制器生产选型：无状态、有状态、守护进程、任务调度适配场景

### 生产问题

团队所有服务都用 Deployment：数据库 Pod 重建丢网络身份、上游连接全断；日志采集器没全节点覆盖；定时任务多副本重复执行。**控制器选型错误，负载跑在不匹配的生命周期模型上，每个特性都被破坏**；在云生态下还要多答一题：这个有状态负载，到底该上 K8s 还是直接用云产品？

### 传统方案失效原因

- **一刀切 Deployment**：无状态、有状态、节点级、任务全一个模型，特性全错配；有状态中间件用 StatefulSet 自建，更等于把主备切换、备份、高可用、版本升级这些云产品已产品化的能力全接到自己团队头上。

失效根因：**既没按负载特性选生命周期模型，也没按团队能力选自建还是云托管**。

### 架构约束与权衡

四类核心控制器的适配场景：

| 控制器 | 适配场景 | 关键特性 | 错配后果 |
|---|---|---|---|
| **Deployment** | 无状态服务（API/网关） | 随机 Pod 名、可随意替换、滚动更新 | 跑有状态：丢身份 |
| **StatefulSet** | 有状态服务 | 稳定网络身份、有序启停、PV 随身份绑定 | 跑无状态：过度复杂 |
| **DaemonSet** | 节点级服务（日志/监控/网络 agent） | 每节点一个、跟随节点池扩容 | 跑普通服务：覆盖错 |
| **Job/CronJob** | 一次性/定时任务 | 跑完即止、重试、并发控制 | 跑成服务：永不结束/重复执行 |

云生态下有状态中间件的必答决策表（云产品是生产默认解）：

| 决策 | 适用条件 | 代表落点（阿里云主参考 / AWS 对照） |
|---|---|---|
| **用云产品（生产默认）** | 数据可靠性/高可用有 SLA 要求、团队无专职中间件运维 | MySQL → RDS / RDS；Redis → 云数据库 Redis 版（Tair）/ ElastiCache；Kafka → 消息队列 Kafka 版 / MSK |
| **上 K8s（StatefulSet）** | 云产品无对应类型（自研有状态服务）、dev/qa 降本、团队具备 Operator 化运维能力 | dev 环境单副本 MySQL；已有成熟 Operator 的中间件 |

把「适用条件」拆成显式决策变量（DDIA 式"取决于什么"）：

| 决策变量 | 倾向云产品 | 倾向 K8s（StatefulSet） |
|---|---|---|
| 数据价值/停机代价 | 高——payment-api 的交易数据，停机按分钟计损 | 低——dev/qa、可重建数据 |
| 团队运维能力 | 无专职中间件运维 | 有 Operator 化运维与值班储备 |
| 规模/规格阈值 | 主流规格内（RDS 高可用版直接覆盖） | 云产品无对应类型/规格，或 dev 降本 |

权衡的核心：**StatefulSet 给的是"稳定身份 + PV 绑定"，不给的是"主备切换/备份/高可用"**——后者在云产品上是产品能力，自建则是一个团队的长期人力与 on-call 负担。

### 最小可行方案

1. 无状态 → Deployment，滚动更新参数按容量定（落地实现的参数表）。
2. 有状态 → 生产优先云产品（RDS/Redis/Kafka 版）；确需上 K8s 才 StatefulSet + 云盘 PV（第 7 章）。
3. 节点级 → DaemonSet，覆盖所有节点池（含专用池需配容忍，6.3）。
4. 任务 → Job/CronJob，配重试上限与硬超时，杜绝"跑成服务"。

### 生产落地实现

**① Deployment + 滚动更新参数**（核心服务模板；探针完整配置见 6.1）：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: demo-api, namespace: prod }
spec:
  replicas: 4
  strategy:
    rollingUpdate:                # type 默认即 RollingUpdate，显式声明亦可
      maxUnavailable: 0           # 生产禁改（核心服务）：滚动期间可用副本不减
      maxSurge: 1                  # 可调：先多起 1 个新副本再杀旧的，瞬时 +1 是容量不减的代价
  selector: { matchLabels: { app: demo-api } }
  template:
    metadata: { labels: { app: demo-api } }
    spec:
      containers:
      - name: api
        image: registry.cn-hangzhou.aliyuncs.com/<ns>/demo-api:1.42.0   # ACR：tag 不可变，禁 latest
        readinessProbe: { httpGet: { path: /ready, port: 8080 } }       # 滚动安全的前提：readiness 把关新副本
```

| 参数 | 默认 | 生产建议 | 权衡 |
|---|---|---|---|
| maxUnavailable | 25% | 核心服务 0，一般服务 1 | 滚动期间最多不可用副本；0 = 容量不减但滚动更慢 |
| maxSurge | 25% | 25%–100% | 滚动期间最多超出副本；越大滚动越快、瞬时资源峰值越高 |
| revisionHistoryLimit | 10 | 3–5 | 历史版本保留数，即"可回滚距离" |

rollout 命令序列（滚动观测与应急回滚；均匀替换不是灰度，金丝雀/流量切分归第 10 章 Argo Rollouts）：

```bash
kubectl -n prod rollout status deploy/demo-api --timeout=3m   # 超时=滚动卡死 → 6.1 探针排障
kubectl -n prod rollout undo deploy/demo-api                  # 应急回滚上一版（2h 内回写 Git，12.3）
kubectl -n prod rollout restart deploy/demo-api               # 滚动重启（证书/配置热更）
```

**ConfigMap 热更新陷阱**（`rollout restart` 常被误当"配置热更"用）：env 方式注入的 ConfigMap **永不更新**——Pod 启动时即快照；volume 方式挂载的延迟约 1 分钟才同步，且同步**不触发滚动重启**。生产正解是配置变更走滚动：immutable ConfigMap + 新名字 + GitOps 滚动发布（或应用自带热加载开关），禁止"改了 CM 等生效"。

**② StatefulSet 关键段**（spec 节选：selector/Pod 模板与 6.1 同构；确需上 K8s 的有状态负载）：

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: demo-mq, namespace: prod }
spec:
  serviceName: demo-mq-svc          # 必须指向 headless Service：稳定 DNS = <pod>.<svc>.<ns>.svc
  replicas: 3
  updateStrategy:
    rollingUpdate: { partition: 0 } # 可调：设 2 = 只滚动序号 ≥2 的 Pod（金丝雀先行）
  volumeClaimTemplates:             # 每 Pod 一个独立 PV，随序号身份绑定（云盘 CSI，第 7 章）
  - metadata: { name: data }
    spec:
      accessModes: [ "ReadWriteOnce" ]
      storageClassName: alicloud-disk-essd   # ACK 默认 StorageClass（对照 EBS gp3，第 7 章）
      resources: { requests: { storage: 100Gi } }
```

**③ DaemonSet 关键段**（spec.template.spec 节选；与 Deployment 只差两点：每节点一个 + 按节点滚动）：

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata: { name: log-agent, namespace: logging }
spec:
  updateStrategy:
    rollingUpdate: { maxUnavailable: 1 }   # 可调：同时最多 1 台节点的 agent 更新，中断窗口最小
  template:
    spec:
      tolerations:                         # 节点级 agent 要覆盖所有节点池：须容忍专用池污点（6.3）
      - { key: dedicated, operator: Exists, effect: NoSchedule }   # 未容忍则专用节点成监控盲区
```

**④ CronJob 最小骨架**（定时任务三件套：硬超时 + 并发策略 + TTL 清理）：

```yaml
apiVersion: batch/v1
kind: CronJob
metadata: { name: report-gen, namespace: prod }
spec:
  schedule: "17 2 * * *"            # 每天 02:17：避开整点错峰，防同频雪崩
  concurrencyPolicy: Forbid         # 生产禁改：上轮未结束禁止重叠（除非任务已验证幂等）
  successfulJobsHistoryLimit: 3     # 成功保留 3/失败保留 1（均为默认）
  startingDeadlineSeconds: 300      # 可调：错过调度 5min 内补跑、超期放弃
  jobTemplate:
    spec:
      backoffLimit: 2               # 可调：默认 6；写库类任务调小，防重复副作用
      activeDeadlineSeconds: 1800   # 生产禁改：30min 硬超时，挂死任务不再占资源
      ttlSecondsAfterFinished: 3600 # 可调：完成 1h 后自动清理 Job/Pod
      template:
        spec:
          restartPolicy: Never      # Job 只用 Never/OnFailure，禁 Always
          containers:
          - name: gen
            image: registry.cn-hangzhou.aliyuncs.com/<ns>/report-gen:1.8
```

云服务映射与数字：四类控制器都跑在 ACK/EKS 上，真正的云权衡集中在"有状态"一行——一台 RDS 高可用版实例的月费，通常低于自建 3 副本 StatefulSet 的 ECS + 云盘成本，且还没算备份脚本、切换剧本与 on-call 人力（价格以官网当期为准）；dev/qa 则反过来，单副本 StatefulSet 比云数据库实例便宜，是"上 K8s"行的典型场景。

### 典型故障案例

某团队数据库用 Deployment + 云盘 PVC，节点池自动升级 drain 后 Pod 重建、IP 变化，上游连接池全断报错 5 分钟。先改 StatefulSet 恢复稳定身份止损；三个月后整体迁 RDS（主备切换、自动备份交给云产品），删掉了自维护的备份脚本与切换剧本。

点评：**有状态负载用 Deployment 是经典翻车；长期解在云生态下常常不是 StatefulSet，而是云产品**。

### 根因定位

问题的真正发源地是**用一种生命周期模型套所有负载**——控制器特性是它与负载特性的契约，不是免费通用性。

### 长效治理方案

- 四类负载的控制器与默认参数进基础 chart 模板（第 8 章），"一刀切 Deployment"在 CI 拦截。
- 生产有状态中间件默认云产品（RDS/云数据库 Redis 版/消息队列 Kafka 版），上 K8s 需平台组审批留痕。
- 存量 CronJob 全量补齐硬超时 + 并发策略 + TTL 三件套，纳入配置巡检（第 13 章）。

### 自动化/自治闭环

控制器是 L1 机械自治（第 5 章）调谐闭环的载体——选对控制器，自愈与滚动才按负载特性收敛；选错，自治会"按错误的方式自愈"（如重建有状态服务丢身份）。

### 生产检查清单

- [ ] 无状态 Deployment、节点级 DaemonSet、任务 Job/CronJob 各就各位？
- [ ] 核心服务 maxUnavailable=0（容量不减滚动），maxSurge 受团队配额约束（6.4）？
- [ ] 生产 MySQL/Redis/Kafka 走云产品（RDS/云数据库 Redis 版/消息队列 Kafka 版），上 K8s 有审批？
- [ ] CronJob 有硬超时 + 并发策略 + TTL 清理三件套？
- [ ] rollout status/undo 进入应急 SOP（12.3），回滚后 2h 内回写 Git？

---

## 6.3 高级调度策略：节点/Pod亲和性、污点容忍、多可用区高可用调度

### 生产问题

某服务 5 个副本全调度到同一个节点，一次故障全挂；更贵的翻法在高配专用池：通用负载没约束地混进高内存专用节点池——一台高配机型的时薪常是通用规格的 3–10 倍（以官网当期价为准），几十元的 sidecar 占着几百元的高配节点（跑错池一天的差价，够这台 sidecar 本该用的通用节点跑一周）。**调度策略缺失，副本分布与成本都听天由命**——高可用的坑之上，云上还叠加了成本的坑。

### 传统方案失效原因

- **不配拓扑分布/反亲和**：默认调度只看资源够不够，不保证分散，副本可能扎堆。
- **不用污点隔离专用节点**：高配池/专用池对普通 Pod 敞开，成本与干扰双输。
- **不考虑故障域**：多 AZ 节点池建了（4.2），可用区分散却没进调度约束，白建。

失效根因：**调度只考虑"能不能跑"，不考虑"分散高可用"与"该不该跑"**。

### 架构约束与权衡

| 策略 | 作用 | 权衡 |
|---|---|---|
| **nodeAffinity** | 钉到/避开特定节点池（按节点池标签） | required 硬约束易 Pending；preferred 软约束可能落空 |
| **taint/toleration** | 专用节点池隔离（污点排斥，容忍才能进） | 忘配容忍 = Pending（4.3 判定表 `untolerated taint` 一行直达） |
| **podAntiAffinity** | 副本互斥不扎堆 | required 在大集群调度开销大，生产常用 preferred |
| **topologySpreadConstraints** | 跨拓扑域均匀分布（maxSkew 精准控制） | DoNotSchedule 严格但易 Pending；ScheduleAnyway 降级保调度 |

权衡的核心：**用调度约束换高可用与成本正确**——约束越多越难调度（资源碎片），但故障域分散越好、专用池越干净；生产按"区维度硬约束、节点维度软约束"分级。

### 最小可行方案

1. 关键服务 topologySpreadConstraints 跨可用区 maxSkew=1（DoNotSchedule）+ 节点维度软分散。
2. 高配/专用节点池在节点池定义里打污点 + 标签；专用负载用 toleration + nodeAffinity 双向锁定。
3. 通用负载用 nodeAffinity 软避开专用池，与污点互为双保险。
4. PDB 保住自愿中断时的最少副本（节点池自动升级/修复的 drain 全靠它，第 5 章）。

### 生产落地实现

**① 节点池侧：标签 + 污点**（源头在节点池定义，不在单台节点）——ACK 创建高配专用节点池时在"节点池 → 标签与污点"配置（Terraform 同名字段；EKS 托管节点组同样支持 labels/taints）：

```yaml
# 高配专用节点池关键字段（Terraform cs_kubernetes_nodepool；EKS managed node group 等价）
labels: { node-pool: perf }       # 节点池标签：调度选择的"正向钩子"
taints:
- key: dedicated
  value: perf
  effect: NoSchedule              # 生产禁改：无容忍的通用负载一律进不来
```

```bash
kubectl taint nodes <node-name> dedicated=perf:NoSchedule    # 应急补污点（正式变更必须回写节点池定义：节点自动修复/重建后手工污点会丢）
kubectl taint nodes <node-name> dedicated=perf:NoSchedule-   # 移除污点（排障临时放行）
kubectl get nodes -L node-pool,topology.kubernetes.io/zone   # 验证：池归属 + 可用区分布
```

**② 业务侧：通用核心服务完整调度配置**（spec.template.spec 节选，与 6.1 探针同一个 Pod 模板）：

```yaml
topologySpreadConstraints:
- maxSkew: 1                                   # 生产禁改：任意两可用区副本数差 ≤1
  topologyKey: topology.kubernetes.io/zone     # ACK/EKS 对多 AZ 节点自动打的区标签（4.2 多 VSwitch）
  whenUnsatisfiable: DoNotSchedule             # 区维度硬约束：宁 Pending 不扎堆
  labelSelector:
    matchLabels: { app: demo-api }
- maxSkew: 1
  topologyKey: kubernetes.io/hostname          # 节点维度软分散：单节点多副本可容忍
  whenUnsatisfiable: ScheduleAnyway            # 可调：资源紧张时允许降级（改 DoNotSchedule 则可能 Pending）
  labelSelector:
    matchLabels: { app: demo-api }
affinity:
  nodeAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:   # 通用负载软避开专用池（污点是硬闸，这是第二道）
    - weight: 100                              # 可调：1–100
      preference:
        nodeSelectorTerms:
        - matchExpressions:
          - key: node-pool
            operator: In
            values: [ general ]
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:   # 同服务副本尽量不同节点（与 hostname 分散互为冗余）
    - weight: 80                               # 可调：低于节点亲和，节点紧张时优先保池正确
      podAffinityTerm:
        topologyKey: kubernetes.io/hostname
        labelSelector:
          matchLabels: { app: demo-api }
```

**③ 专用负载的反向锁定**（与通用负载对称）：对节点池污点配严格一致的 toleration `{key: dedicated, operator: Equal, value: perf, effect: NoSchedule}`，再加 nodeAffinity 硬约束 `node-pool In [perf]`——"容忍进得来 + 硬钉只进来"双向锁定，防"容忍了却落在通用池"白付高配价。

**④ PDB**（自愿中断保护，托管节点池的必备护栏）：

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: demo-api, namespace: prod }
spec:
  minAvailable: 3          # 可调：4 副本保 3；经验值 ≥ ceil(副本数 × 75%)
  selector: { matchLabels: { app: demo-api } }
```

> PDB 只管自愿中断（节点池自动升级/自动修复的 drain 驱逐），不管节点宕机——宕机的保护靠拓扑分散本身，两者互补。
>
> 警示一：**一个 PDB 的 selector 不要匹配多个控制器**——Deployment 滚动换代期间新旧 ReplicaSet 同时匹配同一 selector，allowedDisruptions 的计算反直觉，甚至阻塞全部驱逐。
>
> 警示二：**PDB 过紧会阻塞节点池自动升级（4.4）**——minAvailable 设得过高，drain 驱逐永远无法满足预算、无限等待，节点升级卡死；PDB 取值要同时过"业务保护"与"节点可滚动"两把尺。

数字基线（多 AZ 容量账）：3 AZ 节点池、副本数取 AZ 数的整数倍（3/6/9）——单 AZ 故障最多丢 1/3 容量，剩余 2/3 由 HPA（6.5）或扩容补齐；副本数 < AZ 数（如 2 副本 3 AZ）时必有区空转，故障容量损失比例反而不可控。

**⑤ PriorityClass：关键服务的优先级护栏**——无 PriorityClass 时所有 Pod 优先级同为 0，节点压力驱逐与资源竞争中关键服务与边缘负载无差异化保护：

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata: { name: critical }
value: 1000000            # 可调：全局唯一数值、越大越先保；globalDefault 禁设 true
```

在 Deployment 的 spec.template.spec 加 `priorityClassName: critical` 即生效：资源不足时调度器可**抢占**低优先级 Pod 为其让位，抢占代价由低优先级负载承担。

### 典型故障案例

5 副本默认调度全落在同一节点（当时它资源最空），一次节点池自动升级 drain 且无 PDB：5 个副本同时重建，服务中断 90s。补 topologySpreadConstraints（zone + hostname，maxSkew=1）+ PDB minAvailable=4 后，同类 drain 逐个驱逐，业务无感。

点评：**topologySpreadConstraints 是多副本高可用的标配，PDB 是节点池自动升级时代（4.2）的必备护栏**——托管集群的节点滚动是常态，缺这两件的集群等于把每次升级变成一次故障演练。

### 根因定位

根因不在节点故障，而在**调度约束缺失导致副本扎堆**——默认调度器不为"分散"负责，分散是应用侧要主动声明的约束；托管节点池自动升级/修复常态化之后，缺约束的集群不是故障变少，而是暴露变频繁。

### 长效治理方案

- 调度四件套（拓扑分散/反亲和/池亲和/PDB）进基础 chart 模板（第 8 章）。
- 节点池标签与污点全量进 Terraform/Git（第 8 章），kubectl 手工污点只作应急且当天回写。
- 副本数按 AZ 数整数倍规划；新节点池上线先跑调度演练，Pending 排障对照 4.3 Events 判定表。

### 自动化/自治闭环

调度策略是 L1 机械自治（第 5 章）的事前防线——拓扑分散保证单点/单区故障后剩余副本够用，控制器再补足副本；没有分散，故障直接全挂，自治来不及救。

### 生产检查清单

- [ ] 关键服务 topologySpreadConstraints 跨 zone maxSkew=1（DoNotSchedule）？
- [ ] 副本数按 AZ 数整数倍，单 AZ 故障容量损失 ≤1/3？
- [ ] 高配/专用节点池的污点 + 标签在节点池定义里（Git 管控），通用负载避开专用池？
- [ ] PDB 覆盖所有多副本服务（节点池自动升级 drain 有护栏）？
- [ ] 关键服务已配 PriorityClass（抢占代价由低优先级负载承担）？
- [ ] 调度约束进业务 chart 模板，Pending 排障走 4.3 Events 判定表？

---

## 6.4 资源配额、层级限制、多租户基础隔离规范

### 生产问题

共享集群里，某团队服务突发吃光节点 CPU/内存，其他团队被挤挂（noisy neighbor）；dev 误操作占满资源波及 qa。**共享集群无资源隔离，租户/环境之间互相伤害**——而多数团队的"隔离"只做到 namespace 命名隔离，资源层面在裸奔，"共享省钱"变成"共享互害"。

### 传统方案失效原因

- 容器不设 limit 互相挤占、namespace 无配额无上限、新负载裸奔进集群。
- 误把 namespace 当硬隔离：它只提供名字与 RBAC/API 边界，资源、故障、网络都是软边界（第 4 章边界思维）。

失效根因：**"软边界 + 零配额"**——隔离要靠 ResourceQuota + LimitRange + request/limit 三层主动建立。

### 架构约束与权衡

三层规范（自上而下：总量 → 兜底 → 单容器）：

| 规范 | 层级 | 作用 | 权衡 |
|---|---|---|---|
| **ResourceQuota** | namespace | CPU/内存/Pod/存储总量上限 | 紧 = 隔离强但易调度失败；松 = 易调度但隔离弱 |
| **LimitRange** | 容器默认 | 未声明 request/limit 的容器自动兜底 | 默认值要贴团队常态，否则形同虚设 |
| **request/limit** | 单容器 | request = 调度依据；limit = 运行上限（cgroup） | request 高 = 留量浪费；limit 高 = 超卖险 |

超卖比例经验值（在线服务基线）：

| 资源 | requests:limits 经验值 | 依据 |
|---|---|---|
| CPU | **1:1 ~ 1:2**（批处理/无状态可放宽至 1:4） | CPU 可压缩：超卖只引起争抢降速，不直接杀进程 |
| 内存 | **1:1（禁超卖）** | 内存不可压缩：超卖落到节点上就是 OOMKilled（6.1），直接转嫁为业务故障 |

权衡的核心：**CPU 超卖买密度、内存不超卖买确定性**——节点上 CPU limits 总量可以到可分配量的 1.5–2 倍，内存 limits 总量不能超过可分配量。

CPU 超卖具体放宽到多少，取决于（变量表）：

| 决策变量 | 放宽（1:2 → 批处理 1:4） | 收紧（1:1） |
|---|---|---|
| 负载类型 | 批处理/无状态——CPU 可压缩、任务可重试 | 在线延迟敏感（payment-api 支付链路） |
| 争抢风险 | 峰值错峰、同节点负载互补 | 峰值同频——大促晚八点全体满载，超卖即互踩 |
| 节点规格 | 大规格节点——单 Pod 占比小，争抢被摊薄 | 小规格节点——2C 节点超到 1:2 就可能互踩 |

### 最小可行方案

1. namespace = 团队/业务边界（team-xxx / 业务域命名，第 4 章），每 namespace 一份 ResourceQuota。
2. LimitRange 兜底默认值，未声明资源的容器自动注入。
3. 所有容器显式 request/limit：CPU ≤1:2、内存 1:1。
4. 强隔离（生产 vs 非生产）不靠配额，靠分集群/专用节点池（附录 A）。

### 生产落地实现

**① ResourceQuota**（namespace = 团队隔离模式）：

```yaml
apiVersion: v1
kind: ResourceQuota
metadata: { name: quota-team-payment, namespace: team-payment }   # namespace = 团队边界：配额即"资源合同"
spec:
  hard:
    requests.cpu: "48"        # 可调：按团队峰值容量 = 峰值副本数 × 单副本 requests
    requests.memory: 96Gi     # 可调：同上
    limits.cpu: "96"          # = requests × 2：CPU 超卖上限
    limits.memory: 96Gi       # 生产禁改：内存 limits 总量 = requests 总量（禁超卖）
    pods: "200"               # 可调：副本数上限，防失控扩容吃掉配额
    requests.storage: 1Ti     # 可调：云盘 PVC 总量（第 7 章）
```

**② LimitRange**（兜底默认值 + 单容器上下限。语义要点：quota 同时出现 requests 与 limits 时，不声明资源的 Pod 会被直接拒绝创建——LimitRange 必须与配额成对出现）：

```yaml
apiVersion: v1
kind: LimitRange
metadata: { name: defaults, namespace: team-payment }
spec:
  limits:
  - type: Container
    defaultRequest:           # 未声明 requests 的容器自动注入
      cpu: 250m
      memory: 512Mi
    default:                  # 未声明 limits 的容器自动注入
      cpu: 500m               # 与 defaultRequest 成 1:2（CPU 超卖基线）
      memory: 512Mi           # 生产禁改：内存默认值 = 请求值（1:1）
    max:                      # 单容器上限：防单个 Pod 吃掉整团队配额
      cpu: "4"
      memory: 8Gi
    maxLimitRequestRatio:     # 单容器 limits:requests 比例上限
      cpu: "2"                # 可调：与团队 CPU 超卖基线一致
      memory: "1"             # 生产禁改：内存禁超卖
```

**③ ECS 规格与 requests 对应**（节点容量速查，规格以官网当期清单为准、实际以 `describe node` 的 Allocatable 为准；隐藏结论：g8i 这类大内存机型跑小 Pod 时瓶颈在 CPU，密度场景选 c1m2 更划算）：

| ECS 规格（ACK 节点池） | vCPU / 内存 | 可分配（经验 ≈80%，扣系统预留与 DaemonSet） | 可承载 Pod（500m / 1Gi） |
|---|---|---|---|
| ecs.u1-c1m2.large | 2 / 4 GiB | ≈1.6 vCPU / 2.6 GiB | 2 |
| ecs.u1-c1m2.xlarge | 4 / 8 GiB | ≈3.2 vCPU / 5.5 GiB | 5 |
| ecs.g8i.xlarge（对照 EKS m7i.xlarge） | 4 / 16 GiB | ≈3.2 vCPU / 12 GiB | 6 |

**④ 配额观测与评审命令**：

```bash
kubectl -n team-payment describe resourcequota                                # 团队配额使用率
kubectl describe node <node> | sed -n '/Allocated resources/,$p' | head -12   # 节点已分配 vs 可分配
```

云服务映射与数字：配额要对得上钱——团队 namespace 的资源用量 × 节点池单价，与阿里云费用中心财务单元（分账账单；对照 AWS Cost Allocation Tags）对齐，"谁超额、花在哪"才可见。评审节奏经验值：**配额使用率 >80% 连续两周 → 扩额评审；<30% 连续一月 → 回收 50%**。

### 典型故障案例

dev 环境一个失控容器（未设 limit）把 8C 节点 CPU 拉满，同节点 qa 服务 P99 从 120ms 涨到 4s。配 ResourceQuota（dev 限额 8C/16Gi）+ LimitRange（默认 500m/512Mi）后，失控容器被 cgroup 限制在单容器额度内，qa 无感。

点评：**共享集群不配额 = 邀请 noisy neighbor**；配额是多租户共存的底线。

### 根因定位

先给结论：翻车不在那一次失控，而在**资源隔离三层规范（配额/兜底/单容器）整体缺位**——namespace 是软边界，不主动加固，互害只是时间问题。

### 长效治理方案

- 每团队 namespace 的 Quota + LimitRange 进基础 chart（第 8 章），新建 namespace 默认下发。
- 配额与云分账账单对齐，>80%/<30% 的评审与回收节奏制度化。
- 强隔离（生产/非生产）用分集群或专用节点池（附录 A），不指望配额兜底。

### 自动化/自治闭环

配额保证 L1 机械自治（第 5 章）的调谐动作不出团队边界——HPA 扩容、Pod 重建都被限制在配额内，自治不会挤垮邻居。

### 生产检查清单

- [ ] 每个 namespace 配 ResourceQuota（requests/limits/pods/storage 全量字段）？
- [ ] LimitRange 默认值贴近团队常态，未声明资源的容器不再裸奔？
- [ ] CPU 超卖 ≤1:2、内存 1:1，maxLimitRequestRatio 有硬约束？
- [ ] 节点容量按 ECS 规格速查规划（以 describe node Allocatable 为准）？
- [ ] 配额使用率接分账账单，>80%/<30% 有评审与回收机制？

---

## 6.5 原生HPA生产痛点解析：聚焦K8s原生弹性缺陷，解答「CPU指标正常但业务请求排队、负载异常」核心问题，与第15章KEDA分层解耦

### 生产问题

先做一个思想实验（先猜，再往下读）：

> 墨丘里商城大促晚八点：demo-api 的 CPU 利用率稳在 38%——离 HPA 扩容线 65% 远得很，HPA 毫无动作；可用户在超时，下单请求越排越长。**先猜：HPA 坏了吗？** 候选三个：① HPA 控制器挂了；② metrics-server 采错了数；③ HPA 没坏，是 CPU 这个信号本身骗了它。选一个，再往下读。

一个反直觉现象：CPU 利用率稳在 38%（HPA 的扩容线根本没碰到），可消息队列越积越深、业务请求排队超时。盯着 Grafana 面板会一脸懵——**CPU 明明不忙，凭什么说负载过载了？** 这不是 HPA 配错，是它看错了信号：弹性按 CPU 决策，瓶颈却在别处。这是 HPA 最经典的生产痛点——**弹性信号错配**。

### 传统方案失效原因

- **开箱只有资源指标**：HPA 内置指标源是 metrics-server 的 CPU/内存；队列深度、QPS、延迟这类业务指标要自建 Custom/External Metrics 适配层（如 prometheus-adapter），且依然没有"面向队列/scaler"的弹性语义。
- **CPU 不忙 ≠ 负载不重**：队列消费者在等消息时 CPU 很低，积压却在恶化；HPA 看 CPU 不动，积压继续涨。
- **扩容链路天生滞后**：HPA 同步周期 15s + metrics-server 采集粒度（默认 60s）+ 新 Pod 过探针就绪（30–60s）——从流量突增到新副本接流量，分钟级起步。
- **缩容震荡**：无稳定窗口时，指标抖动直接传导成副本数来回增减，调度与滚动成本被反复支付。

失效根因：**HPA 假设"CPU 利用率反映负载"，这个假设对大量真实负载不成立**——信号错配，决策必然失准。

### 架构约束与权衡

先写清 HPA 的决策公式（理解一切痛点的基础）：**期望副本 = ceil(当前副本数 × 当前指标值 ÷ 目标值)**，指标落在目标 ±10% 容忍区内则不动作。

揭晓思想实验的答案：③。CPU 利用率从来不是负载本身，只是负载的**代理指标**——HPA 用"CPU 忙不忙"去猜"业务忙不忙"，而这个代理在三种负载下会系统性失真：**(a) IO/锁等待型**——线程全挂在等数据库/等锁上（user-svc 跑重查询时的形态），CPU 空转，负载再重利用率也不涨；**(b) 请求排队型**——消费者在等队列消息，CPU 很低而积压一路恶化（开篇的 demo-api）；**(c) 长连接密集型**——im-gateway 的瓶颈在连接数与内存，CPU 大部分时间"不忙"，连接打满也不会触发扩容。这不是 HPA 的 bug，是代理指标的边界。

HPA 只懂资源指标的边界表（哪些负载留在 HPA、哪些必须走）：

| 负载类型 | CPU 反映真实负载？ | HPA 适配度 | 边界外去向 |
|---|---|---|---|
| CPU 密集（转码/计算） | 是 | 适配 | — |
| 常规 Web/API | 基本反映 | 适配（behavior 调优） | — |
| 队列消费者 | 否（等消息时空转） | 不适配 | KEDA 按队列深度（15.3） |
| IO/网络密集型 | 否 | 不适配 | KEDA 自定义指标（15.3） |
| 长连接网关 | 否（瓶颈在连接数/内存） | 不适配 | KEDA 按在线连接数（15.3） |

四类痛点（只懂资源指标/信号错配/扩缩滞后/缩容震荡）的解药统一在 15.3——本章动作只有两个：**用边界表划清适用范围，把适配的负载用好**。权衡的核心：**本章只暴露 HPA 的原生缺陷并把它用对；业务指标驱动的解药（KEDA）归第 15 章**——严格分层，不在本章展开。

**HPA 的保证等级表**（承诺/不承诺——你到底买到了什么）：

| 保证维度 | 承诺 | 不承诺 |
|---|---|---|
| 收敛目标 | 指标离开 ±10% 容忍区，就按公式朝 CPU 目标值收敛 | 收敛的是代理指标，不是业务延迟——信号错配时扩了也白扩 |
| 评估节奏 | 每 15s 周期性重估，持续跟随 | 两次评估之间的突发——15s 窗口内的世界它看不见 |
| 扩容时效 | 扩容方向 0 稳定窗，出手即翻倍 | 突发的瞬时兜底——采集 60s + 同步 15s + 就绪 30–90s，新副本分钟级才接流量 |
| 缩容行为 | 300s 稳定窗内取最大期望值（5min——一杯咖啡的时间，换缩容不反悔） | 缩容绝不抖动——稳定窗是缓解不是根除，指标口径乱时照样震荡 |

### 最小可行方案

1. **先分类再弹性**：按边界表判定负载是否"CPU 反映负载"；适配的留下，不适配的列迁移清单（15.3）。
2. **适配负载用完整 autoscaling/v2**：不裸奔默认值——目标值与 behavior（扩快缩稳）都显式声明。
3. **参数锚定容量数字**：minReplicas ≥ AZ 数 × 2（6.3），maxReplicas ≤ 团队配额（6.4）。
4. **把滞后算进预算**：分钟级扩容链路意味着 HPA 不能替代容量预留——minReplicas 是防打穿的第一道，不是成本优化项。

### 生产落地实现

**① HPA autoscaling/v2 完整配置**（CPU 适用型在线服务，字段语义以官方文档为准）：

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: demo-api, namespace: prod }
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: demo-api          # 目标容器必须声明 requests：利用率口径的分母就是 requests
  minReplicas: 6            # 可调：≥ AZ 数 × 2（ACK/EKS 多 AZ 节点池，6.3：3 AZ 时单区故障仍剩 2/3 容量）
  maxReplicas: 36           # 可调：≤ 团队配额上限（6.4）；常态触顶 = 该评审容量
  behavior:
    scaleUp:                          # 扩容要快
      stabilizationWindowSeconds: 0   # 扩容不等待（默认 0）：突发必须快
      selectPolicy: Max               # 多策略取扩得最多的
      policies:
      - type: Percent
        value: 100                    # 可调：每 15s 最多翻倍
        periodSeconds: 15             # 上限 1800s
      - type: Pods
        value: 4                      # 可调：小副本基数时每 15s 至少 +4（与 Percent 取大）
        periodSeconds: 15
    scaleDown:                        # 缩容要稳
      stabilizationWindowSeconds: 300 # 生产禁改（默认 300）：取 5min 内最大期望值，防震荡
      selectPolicy: Min               # 多策略取缩得最少的
      policies:
      - type: Percent
        value: 25                     # 可调：每 15s 最多缩 25%
        periodSeconds: 15
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 65        # 可调：60–75 常用区间；越低越灵敏、常态副本越多成本越高
```

> 裸默认对照：不配 behavior 时走内置默认缩放策略——无稳定窗配置生效时缩容行为激进（一次可缩掉全部多余副本，具体默认值以官方文档为准）；生产显式给 behavior（扩快缩稳）是基线。

观测与排障命令：

```bash
kubectl -n prod get hpa demo-api -w       # 实时观察；<unknown>/65% = 信号源有问题
kubectl -n prod describe hpa demo-api     # conditions：AbleToScale/ScalingActive/ScalingLimited
kubectl -n prod top pods -l app=demo-api  # metrics-server 原始值：HPA 的信号源
```

> 信号源前提：metrics-server 可用——ACK 集群默认安装，EKS 需自行安装（Helm，以官方文档为准）。`<unknown>` 常见原因：metrics-server 未就绪或目标容器没声明 requests；`ScalingLimited=True` 表示触达 min/max，常态触顶就该调 maxReplicas 或扩配额。

**② 滞后数字账**（把"慢半拍"算成预算）：流量突增 → metrics-server 可见（0–60s）→ HPA 同步决策（≤15s）→ 新 Pod 调度 + 拉镜像 + 过探针（30–90s）≈ **新副本接流量总计 1–3min**（够用户把页面刷新三四次，也够一部分用户直接离开）；期间缺口只能靠 minReplicas 预留 + 限流（12 章）兜底。

### 典型故障案例

开篇的队列消费者，补全数字复盘：8 副本 × requests 500m，实际各用约 190m → 利用率 38%。目标 65%、容忍区 58.5%–71.5%，38% 远在容忍区之下——按公式 `ceil(8 × 38 / 65) = 5`，HPA 不但不想扩，反而想缩到 5，全靠 minReplicas=8 与 300s 缩容稳定窗口兜住没缩。同一时段队列积压从 2,000 涨到 180,000 条（按当晚消费速率，这 18 万条要再跑数小时才清得完——大促散场了，队列还在还债），消费延迟 p99 从 800ms 涨到 40s，上游超时率 0.3% → 12%。诊断结论：信号错配（瓶颈在队列深度，不在 CPU），调 HPA 参数无解，须换驱动指标——解药在第 15.3（KEDA），本章不展开。

点评：**"CPU 正常但排队"是 HPA 失准的标志性现象**——看到它就别再死调参，先查信号是否错配。

### 根因定位

拆到机制层，是**HPA 的决策信号（资源指标）与负载真实瓶颈（队列深度/IO/连接数）错位**——这是原生设计边界，不是参数问题；调参治标不治本，换信号才行（15.3）。

### 长效治理方案

- 每个弹性负载登记"驱动信号 vs 真实瓶颈"匹配表（本节边界表）；不适配项列入 15.3 迁移清单。
- HPA 适用负载显式声明 behavior（扩容 0 窗口、缩容 300s 稳定窗），禁止裸默认值上线。
- ScalingLimited 常态触发 → maxReplicas/配额评审；缩容震荡先查稳定窗口、再查指标口径；扩缩事件入 Grafana 看板（第 11 章 VM 指标），季度复盘弹性命中率与滞后损耗。

### 自动化/自治闭环

本节是 L1 机械自治与 L2 运维自治的弹性交接点——HPA 够用的负载，弹性留在 L1；信号错配的负载，弹性上移到 L2 业务指标驱动（15.3 KEDA）。识别 HPA 的边界，就是划定弹性的自治分层线。

### 生产检查清单

- [ ] 每个弹性负载判定过"CPU 是否反映真实负载"（边界表）？
- [ ] HPA 显式声明 behavior（扩容 0 窗口/翻倍，缩容 300s 稳定窗 + 25%）？
- [ ] minReplicas ≥ AZ 数 × 2、maxReplicas ≤ 团队配额，且监控 ScalingLimited？
- [ ] 出现"CPU 正常但排队"先诊断信号错配，而非死调参？
- [ ] 不适配负载已列入 15.3（KEDA）迁移清单？
- [ ] 团队对 HPA 保证等级表有共识（只对代理指标负责、不承诺突发瞬时响应与缩容不抖动）？

> **下一章预告**：算力与调度就绪，还差连接与供给——第 7 章讲网络、存储与服务治理：CNI、流量网关、云盘/NAS/OSS 与容灾基线，底座篇至此收束。
