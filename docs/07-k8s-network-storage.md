# 第7章 Kubernetes网络、存储与服务治理
<!-- 第二篇 Kubernetes 底座 ｜ 常规章（严控容灾边界） ｜ 状态：终审中 -->

> 本章定位：讲清托管 K8s（阿里云 ACK 主参考、AWS EKS 对照）的网络、流量入口、存储生命周期与生产容灾极简规范——云 CNI（Terway/VPC-CNI）、SLB/NLB/ALB 流量网关、云盘/NAS/OSS 三种存储、云盘快照与 RPO/RTO 落地。容灾只到快照 + 指标 + 演练原则，深度 DR 归 V2。
> **主线定位**：本章为网络与存储是负载运行的连接层——L1 自愈的服务面管道（三层自治见 1.5；L3 = 运维 Agent 引擎，15.4⑤/15.5）。 **主旨绑定**：业务负载与治理件的连接与供给层——对象/文件存储（OSS/NAS）、流量入口（网关）与镜像拉取管道都落在此章治理面上。 **承上启下**：承第 6 章资源与调度（补齐连接与供给面，底座篇至此收束）；启第 8 章一切即代码（底座上"跑什么、该是什么样"开始写成代码）。

---

## 7.1 集群基础网络通信原理、主流CNI选型与生产运维规范
<!-- 云 CNI 视角：Terway 让 Pod 直通 VPC。运维对象是 vSwitch IP 容量、ENI/IP 配额、安全组与 terway-eniip 组件日志四件事。 -->

### 生产问题

跨节点 Pod 偶发超时，团队从节点路由与网络封装入手排查，越排越远。**云 CNI 时代的故障换了发源地：vSwitch IP 耗尽、节点 ENI/IP 配额打满、安全组没放行对端**，表现却是最会伪装的"Pod 拿不到 IP 一直 Pending"或"跨节点不通"。

### 传统方案失效原因

- **排障入口错位**：盯节点路由与封装，不会查 Terway 日志与 VPC 配额（4.2 同病）。
- **IPAM 无容量规划**：Pod 直通 VPC = 每 Pod 吃一个 vSwitch IP，不规划网段，扩容即耗尽；NetworkPolicy 想当然——Terway 默认未开启，策略写了不生效。

定论，不再论证：**云 CNI 是要容量规划与健康观测的核心组件，不是"装上就行"的插件**。

### 架构约束与权衡

全书只讲云 CNI：阿里云 **Terway**（Pod 直通 VPC，主参考）、AWS **VPC-CNI**（对照）。Terway 的 ENI 多 IP 模式两种形态对比：

| 对比项 | 共享 ENI 多 IP（默认） | 主 ENI 多 IP |
|---|---|---|
| **IP 来源** | Terway 在节点上挂辅助 ENI，Pod 用其辅助 IP | 直接用 ECS 主网卡的辅助 IP |
| **数据面** | Veth pair + 策略路由 | IPVLAN 子接口，性能更好 |
| **Pod 密度** | 高：`(ENI 数 − 1) × 单 ENI 私有 IP 数` | 低：仅主 ENI 的 IP 配额（以实例规格文档为准） |
| **NetworkPolicy** | 支持（需显式开启） | 支持（需显式开启） |

- 对照 AWS：VPC-CNI 同为 Pod 直通 VPC，Pod 密度 ≈ ENI 数 ×（单 ENI IPv4 数 − 1）+ 2（如 m5.large = 3×9+2 = 29，以实例规格文档为准）。
- （独占 ENI 模式性能最佳但密度最低，仅网络敏感场景按节点池开启。）

**云 CNI（Terway/VPC-CNI）的四条机制要点**：

- **IPAM 在云手里**：VPC/vSwitch 的 IP 即云资源，有配额与容量概念——要规划的是 vSwitch 网段容量，不是"CNI 品牌"。
- **直通 VPC**：veth/ipvlan + 节点策略路由引到 ENI，无封装开销，云 SLB 可直通 Pod。
- **日常运维四件事**：vSwitch IP 容量、ENI/IP 配额、安全组、Terway 组件健康。
- **网络策略双层**：NetworkPolicy（需显式开启）+ 安全组。

权衡的核心：**密度与性能二选一，多数集群选共享 ENI 多 IP；要规划的不是"CNI 品牌"，而是 vSwitch 网段容量**。

### 最小可行方案

1. **用共享 ENI 多 IP**（ACK 默认），按 Pod 规模规划 vSwitch（落地实现②）。
2. **开启 NetworkPolicy**：改 eni-config 重启 Terway 生效；策略先默认拒绝再白名单（附录 A.2）。
3. **观测三件套 + 升级灰度**：terway-eniip 健康、vSwitch 剩余 IP、跨节点连通性（第 11 章）；Terway 先单节点池验证再全量。

### 生产落地实现

**① Terway 开启 NetworkPolicy**（默认关闭，是"策略不生效"的头号原因）：

```bash
kubectl -n kube-system edit cm eni-config          # eni_conf 中 disable_network_policy: "false"（字段名随版本略有差异，以官方文档为准）
kubectl -n kube-system rollout restart ds terway-eniip   # 重启组件生效
```

最小策略 = 默认拒绝（白名单放行的完整策略集顺接附录 A.2）：

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: prod
spec:
  podSelector: {}                 # 作用于命名空间内全部 Pod
  policyTypes: [Ingress]          # 无 ingress 规则 = 拒绝所有入站
```

**② Pod 密度与 vSwitch 容量算例（容量规划核心数字）**：单节点 Pod 上限由实例规格决定——`ecs.g6.4xlarge` = 8 ENI × 单 ENI 30 私有 IP → (8−1)×30 = **210 Pod/节点**（官方示例值，以实例规格文档为准）。vSwitch 网段：20 台满配 = 4,200 个 Pod IP → 至少 **/19**（约 8,190 可用）；常见 /24（254 个）只够半台节点。IP 不够时扩网段或开 IP 前缀模式；对照 AWS 同样按实例配额查表（ENI × 单 ENI IP），另受节点 `--max-pods` 限制。

**③ 排障制品：Pod 无 IP / 跨节点不通分层定位**：

```bash
# 1) Pod 是否拿到 IP（IP 列空白 = CNI/IPAM 层，不是应用层）
kubectl get pod <pod> -o wide
kubectl describe pod <pod> | sed -n '/Events:/,$p'
# 2) vSwitch 剩余 IP（Pod 拿不到 IP 的头号原因）
aliyun vpc DescribeVSwitchAttributes --VSwitchId vsw-xxx | jq .AvailableIpAddressCount
# 3) Terway 组件日志（kube-system 的 terway-eniip，按目标节点定位）→ 4) 跨节点不通查节点安全组是否放行对端 Pod 网段/节点段
kubectl -n kube-system get pods -o wide | grep terway
kubectl -n kube-system logs <terway-eniip-pod> -c terway --tail=100 | grep -iE 'error|alloc|ip'
```

云服务映射：本节能力落在 **Terway + VPC（vSwitch/安全组）**，对照 **AWS VPC-CNI + VPC**——排障入口是"云配额 → 组件日志"。

### 典型故障案例

夜间扩容后新 Pod 批量 Pending，`describe` 显示调度成功但 IP 列空白。分层定位：第 1 层确认无 IP → 第 2 层查出 vSwitch 剩余 IP 为 0（/24 的 254 个早已用完）→ 扩网段恢复，全程 12 分钟；此前同类故障被当"调度器问题"排了两小时。

点评：**云 CNI 的故障常伪装成调度/应用故障**，分层定位比经验直觉快一个数量级。

### 根因定位

问题的真正发源地是**网络资源账缺位**——容量账本只盯"每节点 Pod 数"，没人盯"vSwitch 总 IP 池"，耗尽只是时间问题。

### 长效治理方案

- vSwitch IP 池纳入容量规划：剩余 <20% 告警（第 11 章），扩容前先核网段。
- Terway 健康 + IP 用量 + 连通性探测纳入观测；升级走节点池灰度（4.4 节奏）。
- NetworkPolicy 默认拒绝为上线基线（附录 A.2），策略集随应用清单走 Git。

### 自动化/自治闭环

本节为 L1 机械自治的通信前提：第 5 章控制循环的调度与自愈都依赖 Pod 网络可达——网络层可观测，自治才不会把 Pod 调到拿不到 IP 的节点上。

**补知识点：CoreDNS 与 DNS 解析放大**。K8s 给 Pod 的 `/etc/resolv.conf` 默认带 `ndots:5`——域名点数不足 5 时（多数外部域名都是），解析也先按集群内 FQDN 逐级探测多轮、兜底才走外部上游，高 QPS 服务因此把 CoreDNS 打成"延迟放大器"。

- 症状：大量 2–5 秒的"随机"解析延迟，与 CoreDNS QPS 正相关，副本不足或跨节点查询时加剧。
- 缓解：业务 Pod 用 `dnsConfig` 把 `ndots` 调小（如 2–3）或让确定的外部域直连上游；CoreDNS 副本按核数扩（cluster-proportional-autoscaler 可随集群规模自动调副本数）。
- 标准解：**NodeLocal DNSCache** 在节点本地缓存 DNS，消除跨节点查询与 CoreDNS 单点（dnsConfig 等字段以官方文档为准）。

### 生产检查清单

- [ ] 集群 CNI 为云 CNI（Terway / VPC-CNI）？
- [ ] Terway NetworkPolicy 已开启且默认拒绝策略上线（附录 A.2）？
- [ ] vSwitch 网段按 Pod 总量规划、剩余 <20% 有告警，分层定位命令团队会用？
- [ ] Terway 升级有节点池级灰度预案？
- [ ] 高 QPS 服务做过 DNS 调优（ndots 调小 / NodeLocal DNSCache）？

---

## 7.2 Service四层、Ingress七层网关流量管控、路由治理与生产最佳实践
<!-- 托管 K8s 视角：Service LoadBalancer 由 CCM 落成 SLB/NLB，七层统一走 ALB Ingress。治理对象从"装控制器"变成"注解参数、证书托管、暴露面管控"。 -->

### 生产问题

数一遍集群里的公网 LoadBalancer：47 个 Service = 47 份 LB 实例费 + 47 个公网暴露面，其中 9 个没人认领；对外域名的 TLS 证书散在 4 个团队手里，任何一张过期都是入口级故障。**流量入口失控是双重账单——安全账（暴露面）+ 稳定账（路由与证书）**。

### 传统方案失效原因

- LoadBalancer 滥用：该走 ClusterIP/ALB 的直接开公网 LB，费用与暴露面双输。
- Ingress 路由多团队各加各的，冲突无审计；证书手工上传手工续期。
- 灰度靠手改 Service selector，粗糙且危险（第 10 章讲正确方案）。

定论，不再论证：**公网入口必须收口到统一网关 + 证书托管自动续期**。

### 架构约束与权衡

| 层级 | 组件 | 职责 | 治理要点 |
|---|---|---|---|
| **四层（Service）** | Service + CCM → SLB/NLB | IP/端口负载均衡 | 注解参数、删除保护、暴露面审批 |
| **七层（Ingress）** | ALB Ingress → ALB | HTTP(S) 路由、TLS、虚拟主机 | IngressClass 集中治理、证书托管 |

四层/七层选型一行判断：**HTTP(S) 路由/TLS/路径域名治理 → ALB；裸 TCP/UDP、超低延迟 → NLB**（经典 CLB 仅存量兼容）。权衡的核心：四层简单可控但只懂 IP/端口，七层智能但多一层控制器——生产用"七层收口 + 四层点对点"。

### 最小可行方案

内部互访 → ClusterIP（默认）；对外 Web → ALB Ingress 统一入口 + TLS；裸 TCP/UDP → Service(LoadBalancer)→NLB 受控暴露。规范底线：公网入口只经 ALB/NLB 且必开删除保护；证书统一托管云证书服务自动续期；灰度走 Argo Rollouts（第 10 章）。

### 生产落地实现

**① Service → SLB/NLB 注解全表**（前缀省略为 `service.beta.kubernetes.io/alibaba-cloud-loadbalancer-`）：

| 注解后缀 | 示例值 | 说明 |
|---|---|---|
| `spec` / `address-type` | `"slb.s2.small"` / `"internet"` | CLB 规格（可调，按 QPS）/ 公网或私网 |
| `delete-protection` / `modification-protection` | `"on"` / `"ConsoleProtection"` | 删除保护（生产禁改）/ 配置修改保护 |
| `charge-type` / `bandwidth` | `"PayByTraffic"` / `"45"` | 计费方式 / 带宽峰值（默认 50） |
| `protocol-port` / `cert-id` | `"https:443"` / `"${CERT_ID}"` | TLS 监听 / 证书 ID（先托管到云证书服务） |
| `health-check-flag` / `health-check-type` | `"on"` / `"tcp"` | 健康检查开关 / 类型（tcp、http） |
| `health-check-uri` / `health-check-connect-port` | `"/healthz"` / `"31000"` | HTTP 检查路径 / 检查端口 |
| `health-check-interval` / `healthy-threshold` / `unhealthy-threshold` | `"3"` / `"3"` / `"3"` | 间隔（秒）/ 健康 / 不健康阈值 |

**② NLB 生产 YAML**（新一代四层入口，须显式指定可用区与交换机）：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: tcp-gateway
  annotations:
    service.beta.kubernetes.io/alibaba-cloud-loadbalancer-zone-maps: "cn-hangzhou-h:vsw-aaa,cn-hangzhou-i:vsw-bbb"  # 可调：可用区:交换机，至少两个 AZ
    service.beta.kubernetes.io/alibaba-cloud-loadbalancer-delete-protection: "on"    # 生产禁改：防误删
    service.beta.kubernetes.io/alibaba-cloud-loadbalancer-health-check-flag: "on"
    service.beta.kubernetes.io/alibaba-cloud-loadbalancer-protocol-port: "tcpssl:443" # 可调：需要 TLS 卸载时
    service.beta.kubernetes.io/alibaba-cloud-loadbalancer-cert-id: "${CERT_ID}"
spec:
  loadBalancerClass: alibabacloud.com/nlb   # 指定 NLB（K8s ≥1.24 + 新版 CCM）
  type: LoadBalancer
  ports:
  - port: 443
    targetPort: 9443
```

> 旧版 CCM（K8s <1.24）用注解 `...loadbalancer-instance-type: "nlb"` 指定 NLB，键名随版本演进，以官方文档为准；NLB 实例费 + LCU 计费与 CLB 不同，切换前按官网当期价核算。

**③ AWS NLB 对照**（EKS，等价注解换 aws-load-balancer 前缀）：

```yaml
# AWS EKS 注解对照（节选，其余字段同 ②）
service.beta.kubernetes.io/aws-load-balancer-type: "nlb"                    # 指定 NLB
service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"      # 可调：internal 为内网
service.beta.kubernetes.io/aws-load-balancer-ssl-cert: "arn:aws:acm:xxx:123456789012:certificate/abc"  # ACM 证书
```

**④ ALB Ingress 三件套**（AlbConfig 声明实例 → IngressClass 绑定 → Ingress 声明路由）：

```yaml
apiVersion: alibabacloud.com/v1
kind: AlbConfig
metadata:
  name: alb
spec:
  config:
    name: prod-alb                       # 可调：ALB 实例名
    addressType: Internet                # 可调：Intranet 为内网
    zoneMappings:                         # 至少两个可用区各一个交换机
    - zoneId: cn-hangzhou-h
      vSwitchId: vsw-aaa
    - zoneId: cn-hangzhou-i
      vSwitchId: vsw-bbb
  listeners:
  - port: 443
    protocol: HTTPS
    certificates: [{certificateId: "${CERT_ID}"}]   # 证书托管云证书服务，续期自动生效
---
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: alb
spec:
  controller: ingress.k8s.alibabacloud/alb
  parameters:
    apiGroup: alibabacloud.com
    kind: AlbConfig
    name: alb
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: demo-api
  annotations:
    alb.ingress.kubernetes.io/healthcheck-path: "/healthz"   # 与就绪探针同路径
spec:
  ingressClassName: alb
  rules:
  - host: api.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: demo-api
            port:
              number: 80
```

灰度：ALB Ingress 支持 `alb.ingress.kubernetes.io/canary-weight` 等注解做加权灰度，本书统一走 Argo Rollouts（第 10 章），此处不展开。

**⑤ CCM 排障**（SLB/NLB 建不出来、注解不生效——复用 4.2 排障路径）：

```bash
kubectl -n kube-system get pods | grep -E 'ccm|alb'        # 云控制器是否健康（4.2）
kubectl -n kube-system logs deploy/cloud-controller-manager --tail=50   # 失败原因（配额、权限、证书 ID 错）
# 组件名以实测为准：kubectl -n kube-system get deploy | grep -i cloud-controller（版本/发行版不同名称可能不同）
kubectl describe svc tcp-gateway                           # Events 看 CCM 回写状态
```

云服务映射：四层落在 **NLB/CLB（CCM 自动建）**，七层落在 **ALB + 云证书服务**，对照 **AWS NLB/ALB + ACM**。规模判断：入口 <10 个全托管省心；入口规模化后收口到 ALB（单 ALB 支撑数百条路由，费用以官网当期价为准）。

### 典型故障案例

某对外服务 TLS 证书过期未续，HTTPS 中断半天——证书是三年前手工上传的，没人记得到期日。整改：证书统一托管云证书服务（自动续期），ALB 监听引用证书 ID，到期前 30 天告警（第 12 章通道），此后再无证书过期事故。

点评：**手工管理证书 = 等着过期中断**，托管 + 自动续期是唯一可靠方案。

### 根因定位

拆到底，是**入口治理的缺位**：注解、证书、暴露面分散在各团队 YAML 里，没有一张全公司唯一的入口台账——费用与风险都在没人看的地方累积。

### 长效治理方案

- 入口台账唯一：每个公网入口有 owner、证书、暴露端口，季度审计清理无主入口。
- 证书 100% 托管 + 自动续期 + 到期告警；Service/Ingress 模板化进基础 chart（第 9 章），灰度统一走 Argo Rollouts（第 10 章）。

### 自动化/自治闭环

本节是 L1 机械自治的对外接口层：Service/Ingress 让 Pod 的频繁起停与扩缩（第 5 章）对调用方透明——入口抽象稳定，自治动作才对用户无感。

**补知识点：证书生命周期（cert-manager）**。云侧入口证书托管在 SLB/ALB（4.2 的 cert-id 注解、本节 AlbConfig 均是），但集群内部的 TLS——网关→服务的内部证书、admission webhook 证书——不能靠"人肉年度换证"：cert-manager 以 Issuer/ClusterIssuer 声明签发源（Let's Encrypt，对照阿里云数字证书托管服务与 AWS ACM），自动签发、到期前自动轮转，Ingress 注解即可接入：

```yaml
# Ingress 片段：命中 tls 段即自动申请证书写入 Secret、到期自动续（Issuer 需提前创建）
metadata:
  annotations:
    cert-manager.io/issuer: "letsencrypt-prod"
spec:
  tls:
  - hosts: [api.example.com]
    secretName: api-tls        # 证书自动写入此 Secret，网关直接引用
```

### 生产检查清单

- [ ] 公网入口只经 ALB/NLB，且删除保护为 on？
- [ ] 证书统一托管 + 自动续期 + 到期前告警？
- [ ] NLB 的 zone-maps 至少两个可用区？
- [ ] IngressClass/AlbConfig 走 Git（第 9 章），CCM 排障路径（4.2）团队熟知？

---

## 7.3 StorageClass、PV/PVC生命周期管理、存储故障闭环处理
<!-- 云存储视角：CSI 是云盘/NAS/OSS 进集群的门。三种 StorageClass + 拓扑感知绑定 + 快照恢复是主制品；PVC Pending 判定表与 csi-plugin 日志是排障主路径。 -->

### 生产问题

发布夜 23:40，数据库滚动更新卡住：新 Pod 全部 ContainerCreating，PVC Pending 已 40 分钟——没人知道要去看 PVC 的 Events。**存储是有状态服务的命脉，而它的故障最会伪装（表现为 Pod 起不来）、排查路径最深（PVC → PV → CSI → 云盘）、出错代价最高（数据风险）**。

先做一个思想实验（先自己想答案，再往下读）：云盘只能挂在与它同可用区的节点。你建了一个 3 副本服务（比如 7.4② 那只 Kafka），StorageClass 用了默认的 Immediate 绑定——PVC 建出那一刻，就随机挑了个 AZ 把盘建了。现在扩到第 3 个副本：会发生什么？

认真想十秒。答案是：第 3 个副本**永远 Pending**。调度器为它选中的节点在另一个 AZ，而它的卷被钉死在第一个 AZ——卷的拓扑在 PVC 创建那一刻就拍板了，比调度的拓扑决策更早。Events 里就是那句 `volume node affinity conflict`（本节⑤判定表的第一行）。`WaitForFirstConsumer` 的解法由此而来：让卷等第一个 Pod 落位后再建——**卷的拓扑决策必须晚于调度的拓扑决策**，顺序反了就是死锁；本节末的故障案例正是它的现场版。

### 传统方案失效原因

- 不掌握 PV/PVC 生命周期：动态供给、绑定、拓扑约束一片混沌，PVC Pending 只能干等；选型不看 IO 特性与可用区拓扑——PL 级别选错性能不达标，多 AZ 集群里卷与 Pod 拓扑冲突。
- 挂载失败不看 csi-plugin 与 kubelet 日志，只在应用日志里打转。

定论，不再论证：**存储层必须建立"选型 → 供给 → 排障"的工程化路径**。

### 架构约束与权衡

三种云存储的分工（阿里云主参考 / AWS 对照）：

| 维度 | 云盘（块存储） | NAS（文件存储） | OSS（对象存储） |
|---|---|---|---|
| **语义** | 块设备，RWO 单 Pod 挂载 | NFS 共享文件系统，RWX 多 Pod 读写 | 对象桶，只读挂载为主 |
| **拓扑** | **可用区级资源**，不能跨 AZ 挂载 | 地域级，跨 AZ 共享 | 地域级，跨 AZ 共享 |
| **典型负载** | 数据库、消息队列 | 多 Pod 共享目录、共享工作区 | 静态资源只读分发、备份归档 |
| **AWS 对照** | EBS gp3 | FSx for Lustre / EFS | S3 Mountpoint |

三种存储也是三份「契约」——承诺什么 / 不承诺什么（选型前先读"不承诺"列，那是踩坑高发区）：

| 存储 | 承诺 | 不承诺 |
|---|---|---|
| **云盘（块存储）** | 块语义毫秒级低延迟；与 Pod 同 AZ 绑定——拓扑约束不是缺陷，是承诺的一部分（盘与计算同机房） | 多节点同时挂载：RWO = 单节点独占，多路挂载仅限受限场景，跨节点并发读写不在契约内 |
| **NAS** | 多 Pod 跨节点共享读写（RWX）；地域级跨 AZ 可见 | 块存储级延迟与 IOPS——NFS 协议开销换来了共享语义 |
| **OSS** | 海量、便宜、任意多点只读分发 | 写后立读一致（对象存储最终一致）——只读分发场景刚好免疫：文件不可变，从不需要"写完马上读" |

ESSD 性能级别速查（数字以官网为准）：

| 性能级别 | 单盘容量区间 | 单盘最大 IOPS | 单盘最大吞吐 |
|---|---|---|---|
| PL0 | 40 GiB–32 TiB | 1 万 | 180 MB/s |
| PL1（生产默认） | 20 GiB–32 TiB | 5 万 | 350 MB/s |
| PL2 | 461 GiB–32 TiB | 10 万 | 750 MB/s |
| PL3 | 1,261 GiB–32 TiB | 100 万 | 4,000 MB/s |

> 对照 AWS：EBS gp3 单卷基线 3,000 IOPS / 125 MB/s，可付费配到 16,000 IOPS / 1,000 MB/s、单卷上限 16 TiB。

数字体感：PL1 与 PL0 的 IOPS 差（5 万 vs 1 万）是数据库类负载的生死线——生产库高峰的随机读写轻松吃掉上万 IOPS，PL0 的表现是"监控全绿、就是慢"；这 4 万 IOPS 的差价，就是测试盘与生产盘的界线。

权衡的核心：**性能、成本、数据安全的三角**——块存储高性能有拓扑约束，NAS 共享但吞吐随容量增长，OSS 最便宜但非文件语义。按负载选，不一刀切。「按负载选」拆开就是三个决策变量——选型不是单答案，是"它取决于"：

| 决策变量 | 倾向云盘 | 倾向 NAS | 倾向 OSS |
|---|---|---|---|
| 时延要求 | 毫秒级随机读写（事务日志 / WAL） | 百毫秒级可容忍（文件协议开销） | 秒级可容忍（HTTP 拉取 + 本地缓存） |
| 共享需求 | 单 Pod 独占（RWO） | 多 Pod 跨节点并发读写（RWX） | 多 Pod 只读分发（ROX） |
| 数据形态 | 结构化热数据，要块设备语义 | 目录树、中小文件、中量并发 | 海量大文件、写一次读多次 |

静态资源包为何落 OSS 而不是云盘（③ 的 static-assets）：大文件写一次、之后只读分发——用不到块语义的毫秒时延，也不需要单 Pod 独占；放云盘等于为用不到的 IOPS 付费，还把"多点分发"变成"逐副本买盘复刻"。

### 最小可行方案

1. **动态供给为主**：三种 StorageClass 作为平台基座，PVC 按需触发建卷。
2. **按负载选型**：数据库 → 云盘 PL1；多 Pod 共享 → NAS 容量型；静态资源/备份 → OSS。
3. **云盘必配 WaitForFirstConsumer**：卷跟随 Pod 调度建在同可用区（拓扑含义见①注释）；生产 PVC 回收策略一律 Retain，dev 集群才用 Delete。

### 生产落地实现

**① 云盘 StorageClass + PVC + 挂载**（数据库类负载）：

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: alicloud-disk-essd-pl1
provisioner: diskplugin.csi.alibabacloud.com
parameters:
  type: cloud_essd               # ESSD 云盘；PL 级别由 performanceLevel 控制（键名以官方文档为准）
  performanceLevel: PL1          # 可调：PL0 开发测试 / PL2、PL3 高性能（PL3 起步 1,261 GiB）
  fstype: ext4                   # 可调：xfs 适合大容量高并发写
reclaimPolicy: Retain            # 生产禁改：防误删丢数据
allowVolumeExpansion: true       # 在线扩容：PVC 改 storage 即触发
volumeBindingMode: WaitForFirstConsumer   # 生产禁改：等首个 Pod 调度后再建盘，保证云盘与 Pod 同可用区（云盘是 AZ 级资源，建错 AZ 只能重建）
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mysql-data
spec:
  accessModes: [ReadWriteOnce]   # 云盘仅单 Pod 挂载
  storageClassName: alicloud-disk-essd-pl1
  resources:
    requests:
      storage: 500Gi
---
# Pod 挂载片段（节选）
    volumeMounts:
    - name: data
      mountPath: /var/lib/mysql
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: mysql-data
```

成本量级：500 GiB ESSD PL1 月成本约 ¥250–300（以官网当期价为准）；对照 gp3 同容量约 $40/月（以 AWS 当期价为准）——体感：日均不到 ¥10 撑住订单库的存储命脉，而丢一小时数据造成的损失远大于这块盘三年的账单。

扩容语义注意：**PVC 在线扩容只能扩不能缩**——K8s 与云盘 CSI 均无安全的缩容路径，容量配错只能"快照 → 新卷 → 迁数据"重建；扩容失败会卡在 `Resizing`/`FileSystemResizePending`，排查 PV Events 与 csi-plugin 日志的 storage 层事件（常见原因：云盘配额/规格上限、CSI 组件异常）。

**② NAS StorageClass + 多 Pod 共享读写**：

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: alicloud-nas-capacity
provisioner: nasplugin.csi.alibabacloud.com
parameters:
  volumeAs: subpath              # 在已有 NAS 文件系统下按 PVC 建子目录
  server: "nas-xxxx.cn-hangzhou.nas.aliyuncs.com"   # 预创建的通用容量型 NAS 挂载点
  archiveOnDelete: "true"        # 删 PVC 时归档子目录而非直接删除
reclaimPolicy: Retain
volumeBindingMode: Immediate     # NAS 无可用区拓扑，可立即绑定
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shared-workspace
spec:
  accessModes: [ReadWriteMany]   # NAS 支持 RWX：多 Pod 跨节点共享读写
  storageClassName: alicloud-nas-capacity
  resources:
    requests:
      storage: 1Ti               # 声明量用于配额规划，NAS 按实际用量计费
```

吞吐量级（通用容量型 NAS，以官网为准）：初始 150 MB/s、容量每 +1 GiB 吞吐 +0.15 MB/s，读上限 10 GB/s、写上限 5 GB/s；**单客户端（单 Pod）读写带宽上限 500 MB/s**——高吞吐靠多 Pod 并行，不靠单挂载点。数字体感：150 MB/s + 0.15 MB/s/GiB 意味着 1 TiB 的 NAS 才约 300 MB/s——小 NAS 冷启动慢，容量堆上去才跑得动；要喂饱 1 GB/s 的大文件写入约需 6 TiB 起步，否则只能多 Pod 并行（且单 Pod 500 MB/s 封顶）。

**③ OSS StorageClass + 只读挂载静态资源**（写一次读多次的大文件分发锚点）：

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: alicloud-oss-readonly
provisioner: ossplugin.csi.alibabacloud.com
reclaimPolicy: Delete
volumeBindingMode: Immediate
parameters:
  bucket: "static-assets-prod"               # 静态资源桶（报表模板/前端包等）
  url: "oss-cn-hangzhou.aliyuncs.com"        # OSS Endpoint
  path: "/report-templates"                  # 资源目录
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: static-assets
spec:
  accessModes: [ReadOnlyMany]    # 只读多点挂载：静态资源不可变（storage 声明仅占位）
  storageClassName: alicloud-oss-readonly
  resources:
    requests:
      storage: 16Gi
---
# Pod 挂载片段（完整 spec 从略）：报表引擎容器只读挂载资源目录
    volumeMounts:
    - name: assets
      mountPath: /opt/assets
      readOnly: true                         # 生产禁改：资源目录只读
  volumes:
  - name: assets
    persistentVolumeClaim:
      claimName: model-weights
```

> OSS 挂载凭据：新版本 CSI 支持 RRSA/RAM 角色免密，旧版本经 Secret 传 akId/akSecret（以官方文档为准）——能走 RRSA 就不给长期 AK（4.2）。对照 AWS：`s3.csi.aws.com`（S3 Mountpoint），同样主打只读数据面分发。

**④ 云盘快照：备份与恢复闭环**（接 7.4）：

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: alicloud-disk-snapshot
driver: diskplugin.csi.alibabacloud.com
deletionPolicy: Delete        # 可调：Retain 时快照不随 VolumeSnapshot 删除
---
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: mysql-data-20260814
spec:
  volumeSnapshotClassName: alicloud-disk-snapshot
  source:
    persistentVolumeClaimName: mysql-data   # 500GiB 卷打快照，分钟级（增量链）
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mysql-data-restored
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: alicloud-disk-essd-pl1
  resources:
    requests:
      storage: 500Gi          # 不得小于快照源卷
  dataSource:                 # 从快照建新卷：恢复/克隆的声明式路径
    apiGroup: snapshot.storage.k8s.io
    kind: VolumeSnapshot
    name: mysql-data-20260814
```

**⑤ 存储排障：PVC Pending 判定表 + 挂载失败日志路径**：

```bash
kubectl get pvc mysql-data                          # Pending 是入口信号
kubectl describe pvc mysql-data | sed -n '/Events:/,$p'
kubectl -n kube-system get pods -o wide | grep csi-plugin          # 找目标节点上的 CSI 组件
kubectl -n kube-system logs <csi-plugin-pod> -c csi-plugin --tail=100 | grep -iE 'error|fail|create'
# 节点侧：kubelet/容器运行时日志（journalctl -u kubelet）
```

Events / 日志关键字 → 判定表（与 4.3 的 Pod Pending 判定表同风格）：

| 关键字 | 判定 | 去向 |
|---|---|---|
| `volume node affinity conflict` | **拓扑冲突**：Pod 可调度的 AZ 与云盘 AZ 不相交（节点池不均 / 未拓扑打散） | 补节点池 AZ / 拓扑打散（第 6 章） |
| `storageclass.storage.k8s.io "xxx" not found` | StorageClass 名或 provisioner 写错 | 核对 SC 名与 provisioner |
| csi-plugin 日志 `InvalidDiskType` / 规格不支持 | 该 AZ 无此规格（PL3 起步 1,261 GiB、AZ 售罄） | 调 PL 级别或容量 / 换 AZ |
| Events 长时间空白 | 未触发供给或 CSI 组件异常 | 查 csi-plugin Pod 状态与 volumeBindingMode |

云服务映射：块/文件/对象分别落在**云盘 ESSD / NAS / OSS**（各 CSI 插件接入），对照 **EBS gp3 / FSx for Lustre / S3 Mountpoint**。规模判断：单卷 <32 TiB 且要块语义 → 云盘；跨节点共享 → NAS；海量只读与备份归档 → OSS（成本依次递减，以官网当期价为准）。

### 典型故障案例

多 AZ 集群滚动更新数据库，新副本 PVC 一直 Pending。判定表走查：Events 写着 `volume node affinity conflict`——旧副本的云盘在 AZ-h，新 Pod 被调度到只有 AZ-i 节点的节点池。整改：节点池补齐两 AZ + StatefulSet 加拓扑打散（第 6 章）+ SC 保持 WaitForFirstConsumer，定位 3 分钟。

点评：**PVC Pending 大多不是存储坏了，而是拓扑与供给参数错了**——不看 Events 就只能干等。

### 根因定位

根因不在某次挂载失败，而在**存储供给参数与拓扑约束从未被工程化**：StorageClass 是抄来的、拓扑语义没人懂、排障不看 Events——存储黑盒化后，每个故障都从零开始猜。

### 长效治理方案

- 三种 StorageClass 作为平台基座统一交付（基础 chart，第 9 章），业务只声明 PVC；卷使用率与 NAS 吞吐纳入观测（第 11 章）。
- 云盘类负载强制 WaitForFirstConsumer + 多 AZ 节点池 + 拓扑打散；PVC Pending 判定表与 csi-plugin 日志路径进值班手册。

### 自动化/自治闭环

本节为有状态负载的 L1 机械自治提供数据基础：StatefulSet + PV 稳定绑定（第 6 章），Pod 重建数据不丢、快照让"重建"有回退点——存储层可靠，有状态服务的自愈与扩缩才安全。

### 生产检查清单

- [ ] 三种 StorageClass 为平台基座，参数经评审？
- [ ] 云盘 SC 为 WaitForFirstConsumer + Retain + 在线扩容开启？
- [ ] 存储选型按负载（数据库云盘 / 共享 NAS / 只读 OSS）？
- [ ] PVC Pending 判定表与 csi-plugin 日志路径在值班手册？
- [ ] 卷使用率与 NAS 吞吐有观测告警，快照恢复演练过（VolumeSnapshot → 新卷走通）？

---

## 7.4 生产容灾极简规范：PV备份、恢复机制、RPO/RTO指标定义与落地原则（不展开深度DR工具）
<!-- 极简容灾：RPO/RTO 指标驱动，落到云盘自动快照、NAS 备份、多 AZ 拓扑与资源级备份四件云能力。跨集群/多云深度 DR 归 V2。 -->

### 生产问题

某次云盘介质故障导致数据库 PV 损坏，团队这才发现：没有备份机制，也回答不了"最多丢多少数据、多久能恢复"。**没有容灾规范的生产，一次数据事故就是灾难——无备份可恢复、无指标评估损失，事后连改进都缺依据**。

### 传统方案失效原因

- 无备份：PV 数据无定期快照，损坏即永久丢失。
- 有备份不演练：真恢复时才发现流程不通、权限缺失。
- 无 RPO/RTO 定义：容灾没有目标，投入没有依据。

定论，不再论证：**容灾 = 指标 + 云快照 + 演练，是目标驱动的体系，不是工具问题**。

### 架构约束与权衡

RPO/RTO 落到具体云能力（指标定义 → 承接能力 → 典型值）：

| 指标 | 定义 | 落到云能力 | 典型值 |
|---|---|---|---|
| **RPO**（恢复点目标） | 可容忍的最大数据丢失窗口 | 云盘自动快照（最快每小时 1 次）；NAS 走云备份 | 核心库 ≤1h，一般服务 ≤24h |
| **RTO**（恢复时间目标） | 可容忍的最长恢复时间 | 快照恢复新盘 + 重调度；多 AZ 副本接管 | 单点 <10min；AZ 级 30–60min（以演练实测为准） |

数字体感：RPO ≤1h 的另一面是"最坏丢整整一小时数据"——对订单库，就是一小时的单要人工对账；这个数够不够，不由存储团队拍板，要业务方按损失预算签字（与 12.2 的 SLO 定标同一姿势）。

故障域分层一行看全：**单节点/单盘（快照恢复 + 重调度，RTO <10min）→ 可用区级（多 AZ 副本接管，RTO 30–60min）→ 地域级深度 DR（V1 不做，归 V2）**。

权衡的核心：**容灾用成本换数据安全**——RPO 越小快照越频繁（存储成本上涨）、RTO 越短恢复能力要求越高。按业务重要性分级定指标；快照按增量计费，远低于再买一块盘（以官网当期价为准）。

### 最小可行方案

1. **定指标**：按业务分级定义 RPO/RTO（核心库 1h/10min，一般服务 24h/1h 量级）。
2. **云盘自动快照**：按 RPO 配策略（每小时 → RPO ≤1h）。
3. **多 AZ**：节点多 AZ + 云盘同 AZ 拓扑约束（WaitForFirstConsumer，7.3）。
4. **资源级备份 + 演练**：应用与卷一起备（ACK 备份中心/Velero），季度恢复演练。

### 生产落地实现

**① 云盘自动快照策略（RPO ≤1h）**：

```bash
# 每天 24 个时间点（整点各一次）→ 最坏丢 1 小时数据；保留 7 天
aliyun ecs CreateAutoSnapshotPolicy \
  --Name db-rpo-1h \
  --RepeatWeekdays "1,2,3,4,5,6,7" \
  --TimePoints "0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23" \
  --RetentionDays 7          # 可调：合规要求更长；-1 为永久保留

# 绑定目标云盘（策略 ID 取自上一步返回；数组参数传法以 aliyun CLI 帮助为准）
aliyun ecs ApplyAutoSnapshotPolicy --AutoSnapshotPolicyId sp-xxx --DiskIds.1 d-xxx
```

对照 AWS：EBS 自动快照用 **DLM（Data Lifecycle Manager）或 AWS Backup** 配等价的每小时策略。NAS 为地域级共享存储，用**云备份服务**按计划备份（控制台配置，支持异地，以官方文档为准）；OSS 开版本控制/跨区域复制作对象层兜底。

**② 多可用区：节点多 AZ + 云盘同 AZ 拓扑约束**（云盘是 AZ 级资源不能跨 AZ 挂载；7.3 的 WaitForFirstConsumer 保证"盘随 Pod 建"，多 AZ 节点池 + 以下打散 = 单 AZ 故障只影响该 AZ 副本）：

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: kafka
spec:
  serviceName: kafka
  template:
    spec:
      topologySpreadConstraints:
      - maxSkew: 1                         # 可调：AZ 间副本数差
        topologyKey: topology.kubernetes.io/zone
        whenUnsatisfiable: ScheduleAnyway  # 可调：DoNotSchedule 强制打散
        labelSelector:
          matchLabels: {app: kafka}
```

**③ 资源级备份：ACK 备份中心 / Velero 最小命令**（应用 + 卷一起备）：

```bash
# ACK 控制台一键安装"备份中心"（csdr 组件）后可托管备份计划；命令行等价走 Velero（备份存 OSS/S3 桶）
velero backup create prod-20260814 \
  --include-namespaces prod \
  --snapshot-volumes=true                  # 生产禁改：必须带卷快照，否则只备 YAML 不备数据
velero backup describe prod-20260814 --details    # 验证完成且卷快照数正确
velero restore create --from-backup prod-20260814 --namespace-mappings prod:prod-dr   # 可跨 ns/集群
```

**④ RTO 参考区间与演练验收**：

| 故障域 | 恢复动作 | RTO 参考（以演练实测为准） |
|---|---|---|
| 单 Pod/单盘损坏 | 快照恢复新盘 + Pod 重调度 | <10 min |
| 单 AZ 故障 | 其余 AZ 副本接管（自动重调度 <10 min）；AZ 恢复后回迁 | 30–60 min |
| 地域级深度 DR | 跨地域重建 | V1 不做，归 V2 |

演练验收口径：从快照恢复 500 GiB 卷 + 应用接回流量全程分钟级（实测常见 <10 min）；云盘快照是**崩溃一致**（crash-consistent）的——相当于"突然断电瞬间"的盘像，数据库类应用恢复后通常需回放 WAL/binlog 补齐事务才可用，因此验收必须恢复到"应用可读写"，而非"卷可挂载"——备份成功 ≠ 可恢复。升级前的资源级备份同走本节机制（4.4 已交叉引用）。

云服务映射：快照/备份落在**云盘快照策略 + 云备份（NAS）+ OSS（备份存放）**，对照 **EBS snapshot/DLM + AWS Backup + S3**；备份中心功能本身无额外许可费，成本主要是快照与备份存储（以官网当期价为准）。

### 典型故障案例

数据库云盘介质故障数据不可读。因有每小时自动快照：恢复新卷（500 GiB，8 分钟）→ StatefulSet 指向恢复卷重启（4 分钟）→ 应用恢复。实际丢数 47 分钟 < RPO 1h，RTO 12 分钟——复盘后把核心库 RTO 目标从 10 min 校准为 15 min（目标必须以实测修正）；若无备份，同样的故障就是数据永久丢失。

点评：**容灾不能等出事才建**。指标 + 快照 + 演练是底线，深度 DR 工具是后续。

### 根因定位

先给结论：**这不是一次"运气不好"的硬件故障，而是目标缺位**——没有 RPO/RTO 定义，就没有备份频率与恢复能力的量化要求，备份与演练永远不会被排期。

### 长效治理方案

- 按业务分级定义 RPO/RTO，写入服务目录（与 12.2 的 SLO 同级管理）；核心云盘自动快照常开（RPO ≤1h），NAS 云备份、OSS 版本化逐项过配置。
- 季度恢复演练：真恢复、真接流量、真计时，实测回写 RTO 目标。
- 关键状态尽量外置 OSS（7.3③ 模式）降低 PV 单点权重；深度 DR（跨集群/多云）归 V2。

### 自动化/自治闭环

容灾是机械自治的最后防线：L1/L2 自治处理"可自愈的"常规故障，数据层损坏超出自治边界时，快照 + 恢复流程是兜底——自治管"能自动恢复的"，容灾管"必须流程恢复的"。

### 生产检查清单

- [ ] 按业务分级定义了 RPO/RTO 且写入服务目录？
- [ ] 核心云盘自动快照策略生效（RPO ≤1h）并验证过可恢复？
- [ ] 节点多 AZ + StatefulSet 拓扑打散 + WaitForFirstConsumer 三件套齐备？
- [ ] 资源级备份（ACK 备份中心/Velero）带卷快照，存放异地 OSS/S3？
- [ ] 季度恢复演练真恢复、真计时并回写 RTO 目标；深度 DR 明确归 V2？

> **下一章预告**：底座能跑了，"该跑成什么样"要写成代码——第 8 章讲一切即代码：Terraform 管集群之下、Helm 管集群之上，Desired State 从此有唯一真相源。
