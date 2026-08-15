# 附录A 云原生与AI原生生产安全基线
<!-- 附录 ｜ 清单式落地（无新知识·无新组件） ｜ 状态：终审中 -->

> 定位：纯落地检查清单与最小实施方案，不讲解安全理论、不引入新安全组件。每类安全主题统一按四栏表组织：**维度 → 基线要求 → 落地方式 → 检查方法**，每条基线落到可执行的配置片段、命令或云服务名（阿里云主参考、AWS 全程对照）。 **主旨绑定**：AIOps 的权限底座——托管运维 Agent 的云身份按本基线收窄最小权限（15.4 托管对照）。 **承上启下**：全书知识点的权限落地验收（复用正文，无新知识）。

> **内容边界**：附录仅复用正文知识点——云身份联邦 RRSA/IRSA（见 4.2）、镜像供应链（见 2 章）、RBAC 与资源配额（见 6.4）、NetworkPolicy 与安全组（见 7.1）、告警通道（见 12.1），用于落地验证，绝不引入正文不存在的新技术、新平台、新架构。CIS 详细加固、OPA 深度归 V2。

---

## A.1 多租户RBAC最小权限与资源配额隔离

> **风险**：cluster-admin 滥用与宽泛 RoleBinding 是集群被攻破后影响面扩大的主因；共享集群再叠加无配额，越权与互害双层失守（见 6.4）。

| 维度 | 基线要求 | 落地方式 | 检查方法 |
|---|---|---|---|
| 授权粒度 | 按命名空间+角色授最小权限；cluster-admin 仅限平台团队少数人 | Role/RoleBinding（namespace 级）；CI/CD 用专用 ServiceAccount | `kubectl auth can-i --list --as=<sa> -n <ns>` |
| 多租户分层 | 平台/业务/治理件三层权限边界（下表） | 每层一份 Role 模板进基础 chart（见 8 章），新建 namespace 默认下发 | 越层/危险动词 `can-i` 反向验证为 no |
| 资源配额与强隔离 | 每 namespace 配 ResourceQuota+LimitRange；生产/非生产强隔离靠分集群或专用节点池，不靠配额 | 复用 6.4 三层规范（配额/兜底/单容器）+节点池标签/污点 | `kubectl -n <ns> describe resourcequota`；非生产 Pod 不进生产节点池 |
| 用户认证与授权回收 | 人一律 OIDC/SSO，禁静态 token/证书长期凭证；RoleBinding 定期清理过期/过宽授权 | ACK 对接 RAM/SSO；权限矩阵入 Git 季度评审（2.4 同款） | 无长期 token 存活；过期/过宽绑定清单为零 |

多租户三层模型（评审 R14 补齐）：

| 层 | 权限范围 | Role 权限要点 |
|---|---|---|
| 平台团队 | 全集群 | cluster-admin 仅少数值班持有；节点池/集群升级走云控制台+RAM 审批（见 4.4） |
| 业务团队 | 本团队 namespace | 工作负载读+滚动重启/扩缩容写；禁改 RBAC/Quota/NetworkPolicy |
| 治理件（分诊器等智能层制品） | 所在 namespace 限定使用 | 只读监控/变更/工单 API（云身份按 15.4⑤ 最小权限）；无生产写路径；禁碰节点池与集群级资源 |

落地制品——业务团队开发者最小 Role+RoleBinding（治理件同款模式，取数只读）：

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: team-developer
  namespace: team-payment        # namespace = 团队边界（见 6.4）
rules:
- apiGroups: ["apps"]
  resources: ["deployments", "replicasets"]
  verbs: ["get", "list", "watch", "patch", "update"]  # 可调: 写权限按团队自治程度收放
- apiGroups: [""]
  resources: ["pods", "pods/log", "services", "configmaps"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: team-developer-binding
  namespace: team-payment
subjects:
- kind: Group                   # 人走 OIDC 组绑定，不建个人绑定
  name: oidc:team-payment       # 可调: 组名与 IdP 侧对齐
  apiGroup: rbac.authorization.k8s.io
roleRef: { kind: Role, name: team-developer, apiGroup: rbac.authorization.k8s.io }
```

正反验证用一条命令族：`kubectl auth can-i --list --as=system:serviceaccount:team-payment:ci -n team-payment`（正向：权限应只有读+滚动写）；`kubectl auth can-i delete namespaces --as=<同上>`（反向：期望 no）。

> **常见错误**：给业务 SA 绑 cluster-admin 图省事；通配符 `verbs: ["*"]` + `resources: ["*"]`；离职/换岗不清绑定；把 namespace 当硬隔离却不配额。

---

## A.2 网络隔离基线：安全组与NetworkPolicy

> **风险**：云网络默认"VPC 内互通、Pod 全互通"——横向移动无阻；公网入口不收敛则纵向也无阻（见 7.1）。

| 维度 | 基线要求 | 落地方式 | 检查方法 |
|---|---|---|---|
| 公网入口收敛 | 公网只经 WAF→SLB/ALB 进入；节点不对公网暴露业务端口；SSH 22 不对公网 | SLB 仅开 443/80，后端走内网；WAF 回源白名单；SSH 走堡垒机/云助手 | 安全组审计命令核对无业务端口/22 对 0.0.0.0/0 |
| 节点间最小化 | 节点安全组仅放行所需网段与端口（Terway Pod 直通 VPC，见 7.1） | 收紧集群安全组；控制面访问由 ACK 托管安全组管理（以官方文档为准） | 跨节点 Pod 通、公网端口扫描不通 |
| Pod 横向隔离 | namespace 先默认拒绝、再按需白名单 | NetworkPolicy（下方 YAML）；Terway 需先开启 NetworkPolicy（见 7.1） | busybox 探测 Pod 验证该通该断（非网关 ns 内 `wget --timeout=3` 业务端口应超时失败） |
| 出站管控 | 出站默认拒绝，仅放行 DNS 与必要外部端点 | 双向 default-deny+按需放行 | 未放行端点访问超时 |

安全组最小开放基线（端口级四栏）：

| 端口/协议 | 来源 | 开放位置 | 说明 |
|---|---|---|---|
| 443/80 TCP | 公网 0.0.0.0/0 | 仅 WAF/SLB | 唯一公网入口；回源走 WAF→SLB 内网；80 仅 301 跳转、可不开放 |
| 业务端口（如 8080/TCP） | SLB/网关所在安全组 | 节点安全组 | 后端流量，绝不直接对公网 |
| 22/TCP | 堡垒机网段 | 节点/ECS 安全组 | 生产禁改：不对公网 |
| 节点间组件/Pod 网段 | VPC 网段（节点段+容器网段） | 节点安全组 | K8s 组件与 Terway 直通所需，端口清单以 ACK 官方文档为准 |

```bash
# 安全组审计一条命令（阿里云主参考；对照：aws ec2 describe-security-groups --group-ids sg-xxx）
aliyun ecs DescribeSecurityGroupAttribute --SecurityGroupId sg-xxx --RegionId cn-beijing \
  | jq '.Permissions.Permission[] | {PortRange, SourceCidrIp, IpProtocol, Direction, Policy}'
```

NetworkPolicy 制品（default-deny 双向+按需放行；前提：Terway 已开启 NetworkPolicy，见 7.1）：

```yaml
# ① 上线第一条策略：默认拒绝（双向）
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: prod
spec:
  podSelector: {}                     # 命名空间内全部 Pod
  policyTypes: [Ingress, Egress]      # 无规则 = 双向全拒
---
# ② 按需放行：仅网关命名空间可入业务端口；出站仅放 DNS
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway-and-dns
  namespace: prod
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
  ingress:
  - from:
    - namespaceSelector:
        matchLabels: { kubernetes.io/metadata.name: ingress-nginx }   # 可调: 实际网关 ns
    ports: [{ protocol: TCP, port: 8080 }]                            # 可调: 业务端口
  egress:
  - to:
    - namespaceSelector:
        matchLabels: { kubernetes.io/metadata.name: kube-system }
    ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }] # 必须放 DNS，否则双向 deny 即断网
```

> **常见错误**：写了 Policy 但未先 default-deny；Terway 未开启 NetworkPolicy，策略静默不生效（见 7.1 头号坑）；标签 typo 策略空转；只管入站不管出站。

---

## A.3 Pod安全、Secret治理与云身份凭据

> **风险**：特权容器/hostPath/root 运行是容器逃逸三件套；Secret 明文进 Git；AK/SK 长期凭据塞进集群——泄露面从"一个应用"扩大到"整个云账号"（见 4.2 的 17 分钟清桶案例：17 分钟=一把 AK 从泄露到整桶数据被脚本清空，比一次站会还短，人工反应必然迟到）。
> **AK/SK 零容忍（一行）**：所有 Pod 云身份必须走 RRSA/IRSA 临时凭据（见 4.2），本节对其做"全走检查"。

| 维度 | 基线要求 | 落地方式 | 检查方法 |
|---|---|---|---|
| Pod 准入 | namespace 打 PSA 标签：baseline 起步强制、restricted 为目标 | Pod Security Admission 标签（下方 YAML），ACK/EKS 托管控制面内置 | 违规 Pod 被 apiserver 直接拒绝 |
| 运行身份 | 非 root、drop 全部 capabilities、禁 privileged/hostPath/hostNetwork | securityContext 模板进基础 chart（14 章同款） | `kubectl get pod -o yaml` 抽查 securityContext |
| Secret 管理 | Secret 不进 Git；运行时从 KMS 拉取 | External Secrets Operator+KMS（见 9.5）；CI 侧走 protected/masked Variables（见 2 章） | Git 扫描零命中；ExternalSecret→Secret 生成正常 |
| etcd 落盘加密 | Secret 在 etcd 加密存储 | ACK 开启 Secret 落盘加密（对接 KMS）；EKS 建集群时启用 KMS envelope encryption（字段以官方文档为准） | 云控制台确认加密开关已开启 |
| Pod 云身份 | 访问云资源全走 RRSA/IRSA，AK/SK 零进集群 | SA 打 role-arn 注解+RAM 角色（信任策略见 4.2；权限策略见下方 JSON） | SA 注解覆盖检查+集群 Secret 反扫（下方命令） |
| RAM 权限最小化 | 角色只授所需资源前缀与动作 | 只读某 OSS 前缀类策略（下方 JSON），宁缺勿滥 | 越权操作被 RAM 拒绝 |

落地制品①——RRSA 全走检查（正向覆盖+反向兜底）：

```bash
# 1) 已启用云身份注解的 SA 清单（对照业务清单，无遗漏即"全走"）
kubectl get sa -A -o jsonpath='{range .items[?(@.metadata.annotations.alibabacloud\.com/role-arn)]}{.metadata.namespace}/{.metadata.name}{"\n"}{end}'
# 2) 反向兜底：全量 Secret 解码后扫云 AK 特征（阿里云 LTAI 前缀、AWS AKIA/ASIA 前缀），命中即违规
#    Git 侧同口径再跑一遍 git grep（secret 不进 Git 的验证，模式同下）
kubectl get secrets -A -o json \
  | jq -r '.items[] | .metadata as $m | .data // {} | to_entries[] | [$m.namespace,$m.name,.key,(.value|@base64d)] | @tsv' \
  | grep -E '(LTAI|AKIA|ASIA)[A-Za-z0-9]{16,}'
```

落地制品②——RAM 角色最小权限策略（分诊器只读监控/变更/工单 API，15.4⑤ 引擎云身份）：

```json
{
  "Version": "1",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["cms:QueryMetric*", "log:Get*", "log:List*"],
    "Resource": ["*"]
  }, {
    "Effect": "Allow",
    "Action": ["cs:Describe*", "cs:Get*"],
    "Resource": ["acs:cs:*:*:*"]
  }]
}
```

落地制品③——Pod Security Admission 标签（baseline 起步、restricted 目标）：

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: team-payment
  labels:
    pod-security.kubernetes.io/enforce: baseline         # 起步：先强制 baseline（禁特权/hostPath）
    pod-security.kubernetes.io/enforce-version: v1.31    # 可调: 锁集群当前次新版本
    pod-security.kubernetes.io/audit: restricted         # 目标：restricted 先审计告警不阻断
    pod-security.kubernetes.io/warn: restricted          # API 返回警告，收敛后再切 enforce
```

> **常见错误**：为调试开 privileged 不关；ESO 链路没配好退回明文 Secret；PSA 一步切 enforce=restricted 导致存量全挂（应 audit/warn 先行）。

---

## A.4 镜像供应链与运行时准入

> **风险**：`latest`/未签名/未扫描镜像是供应链投毒与配置漂移的双入口（完整链路见 2 章）。

| 维度 | 基线要求 | 落地方式 | 检查方法 |
|---|---|---|---|
| 版本锁定 | 禁 `latest` 进生产；一律 digest 或不可变 tag | Git values 由 CI 回写 digest（见 2.2）；ACR/ECR tag 不可变+删除保护（见 2.4） | 部署清单扫描无 `latest`；覆盖 tag 被仓库拒绝 |
| 漏洞扫描 | HIGH,CRITICAL 阻断发布 | CI trivy 闸门（见 2.3）+ ACR/ECR 内置扫描，双闸门统一口径（见 2.4） | 无 HIGH,CRITICAL 带病上线记录 |
| 制品验签 | 未签名制品不进生产 | cosign 对 digest 签名/验签（见 2.4）；验签接准入控制器的深度归 V2 | `cosign verify` 非零退出即拦截 |
| 来源白名单 | 生产只从 ACR/ECR 拉取 | ACK 免密组件（RRSA/节点云身份，见 2.4）；EKS 节点角色拉 ECR | 无公网镜像引用；无长期 imagePullSecret |
| 镜像精简 | 多阶段构建+精简基础镜像，非 root 运行 | 构建规范与体积/层数上限校验（见 2.3）；secrets 绝不入镜像层；运行时隔离同 A.3 PSA | CI 体积/层数闸门生效 |

发布前最小验证对（完整闸门见 2.3/2.4）：

```bash
cosign verify --key cosign.pub \
  acrbook-registry.cn-hangzhou.cr.aliyuncs.com/prod/demo-api@sha256:1f2e3d4f5a6b...   # 验签失败即非零退出
trivy image --severity HIGH,CRITICAL --exit-code 1 \
  acrbook-registry.cn-hangzhou.cr.aliyuncs.com/prod/demo-api:1.4.2                    # 高危命中即 exit 1
```

> **常见错误**：扫描出报告但不阻断；tag 可被覆盖；从公网任意仓库拉镜像（来源不可信）。

---

## A.5 AI引擎与智能制品安全

> **风险**：运维 Agent（分诊器/值班问答）是新的高价值入口——模型 API 密钥泄露=账单被盗刷；引擎云身份过宽=可读全量生产数据；prompt/白名单制品被篡改=建议质量被操纵。智能层的安全基线是主旨落地的准入条件（15.4⑤/15.5）。

| 维度 | 基线要求 | 落地方式 | 检查方法 |
|---|---|---|---|
| 引擎云身份 | 只读监控/变更/工单 API，无生产写路径 | RAM 最小权限（A.3 制品②）+ RRSA/IRSA 绑定 SA（15.4⑤） | `can-i` 反向验证无写动词；A.3 反扫无命中 |
| 模型 API 密钥 | 密钥不进 Git、不进镜像、不落明文环境变量 | ESO+KMS 注入（同 A.3 Secret 基线）；或云上临时凭据 | Git/镜像双扫描零命中；泄露可一键轮转 |
| 智能制品完整性 | prompt/评测集/规则表/白名单进 Git、走 PR 评审、版本可回放 | 与基础设施同一条 GitOps 供应链（8/9 章、15.5②） | 台账可回答"这条建议出自哪个 prompt 版本"；直改零容忍 |
| 建议通道隔离 | 建议只进工单与台账，不直连执行通道 | 分诊器输出两去向（15.4⑤ 铁律）；执行走白名单 | 引擎无 kubectl/argocd 写权限；审计无越权记录 |
| token 预算护栏 | 日预算封顶，超限自动降级 | 预算配置随分诊器部署（15.4⑤） | 超预算自动降级事件可在台账回查 |
| 值班问答边界 | 只读查询、无生产写路径 | 15.5④ 制品边界；输出仅诊断与 PromQL 草稿，查询由人工执行 | 问答接口无写动作；越界请求被拒 |

> **常见错误**：把模型 API key 写进 values.yaml 提交 Git；给分诊器绑可写 Role"图方便"；prompt 改动不走 PR 直接 kubectl edit（漂移且不可回放）；让问答接口直连 kubectl。

---

## A.6 审计与告警闭环：云操作审计、K8s审计与智能层追溯

> **风险**：谁改了 RAM 策略/安全组、谁动了白名单、哪条建议被自动执行——无审计则滥用不可追溯；审计不接告警则异常长期潜伏。

| 维度 | 基线要求 | 落地方式 | 检查方法 |
|---|---|---|---|
| 云操作审计 | ActionTrail/CloudTrail 开启，管理写操作全留痕，留存 ≥180 天（=半年内任何一次可疑操作都可回查——只靠云端默认 90 天窗口，上个季度以前就查不动了） | 单账号追踪投递 OSS/SLS（下方命令）+生命周期规则 180 天以上（云端默认可查询窗口约 90 天，以官方文档为准） | 抽查任一敏感操作可查到操作者与时间；生命周期规则核对 |
| K8s 审计 | API 审计日志开启 | ACK 控制台开启审计日志投递 SLS；EKS 开启 control plane logging（下方命令） | 审计日志库有近期 apiserver 事件 |
| 敏感操作告警 | RAM 策略变更/安全组变更/角色提权即告警 | ActionTrail→SLS 告警规则（事件名如 CreatePolicy、AuthorizeSecurityGroup），通道接 12.1 分级路由（P1 起步） | 演练一次变更，告警 5 分钟内触达值班 |
| 智能制品审计 | 白名单/规则表/prompt 变更全留痕（谁、何时、改了什么） | 制品在 Git 走 PR（天然审计）；线上对象变更经 ArgoCD 同步（9 章） | 任意线上规则可回溯到 commit 与评审人 |
| 建议与执行审计 | 每条建议三字段 + prompt 版本 + 采纳结果 + 自动执行记录落台账 | 12.4 台账扩展字段（15.5③） | 可回答"这条自动扩容出自哪条建议、谁评审的" |

落地制品——审计开启（命令级，字段以官方文档为准）：

```bash
# ① ActionTrail 创建追踪并投递 OSS（阿里云主参考；桶提前创建并配生命周期 ≥180 天）
aliyun actiontrail CreateTrail --RegionId cn-beijing \
  --Name ops-baseline-trail \
  --OssBucketName ops-audit-logs \
  --EventRW Write          # 可调: All=读写全量（存储与成本翻倍）
aliyun actiontrail StartLogging --Name ops-baseline-trail

# ② 对照 AWS：CloudTrail 开启并投递 S3（S3 生命周期 ≥180 天）
aws cloudtrail create-trail --name ops-baseline-trail --s3-bucket-name ops-audit-logs \
  && aws cloudtrail start-logging --name ops-baseline-trail

# ③ EKS 控制面审计日志（对照 ACK 控制台"审计日志"开关，投递 SLS）
aws eks update-cluster-config --name <cluster> --region <region> \
  --logging '{"clusterLogging":[{"types":["api","audit"],"enabled":true}]}'
```

> **常见错误**：审计开了没人看（无告警联动）；把云端默认 90 天可查询窗口当合规留存；推理接口无调用日志，盗刷不可追溯。

---

## 基线检查项汇总清单

**A.1 多租户与配额**

- [ ] 业务/算法 SA 无 cluster-admin，`kubectl auth can-i` 正反验证通过？
- [ ] 三层权限模型（平台/业务/算法）有 Role 模板并随基础 chart 下发？
- [ ] 每 namespace 配 ResourceQuota+LimitRange（6.4 口径），强隔离靠分集群/专用节点池？

**A.2 网络隔离**

- [ ] 安全组无 22/业务端口对 0.0.0.0/0，公网仅 WAF/SLB 443/80？
- [ ] Terway 已开启 NetworkPolicy（见 7.1），业务 ns default-deny+白名单生效，出站仅放行 DNS 与必要端点？

**A.3 Pod/Secret/云身份**

- [ ] AK/SK 零容忍：集群 Secret 与 Git 双扫描零命中，云身份全走 RRSA/IRSA（见 4.2）？
- [ ] PSA 标签生效（baseline 强制+restricted 审计），特权/hostPath 被拒？
- [ ] Secret 走 ESO+KMS（见 9.5），etcd 落盘加密已开启？

**A.4 供应链**

- [ ] 生产镜像无 `latest`，digest/不可变 tag+cosign 验签（见 2.4）？
- [ ] HIGH,CRITICAL 扫描阻断双闸门（见 2.3/2.4），拉取仅 ACR/ECR 免密？

**A.5 AI 引擎与智能制品**

- [ ] 引擎云身份只读（无生产写路径），模型 API 密钥不进 Git/镜像（ESO+KMS 注入）？
- [ ] prompt/评测集/规则表/白名单进 Git 走 PR，建议通道与执行通道物理隔离？
- [ ] token 日预算封顶可降级，值班问答只读？

**A.6 审计闭环**

- [ ] ActionTrail/CloudTrail 开启且留存 ≥180 天（OSS/S3 生命周期兜底）？
- [ ] RAM 策略/安全组变更告警已接 12.1 分级通道？
- [ ] 智能制品变更可回溯到 commit 与评审人，建议与自动执行记录全量落台账（15.5③）？

---

## 附：安全基线一键检测脚本（示例）

> 复用 A.1–A.6 的检查命令串联成只读巡检脚本（示例基线）：输出 PASS/FAIL 与汇总计数，FAIL>0 按附录 A 分级处置。参数按环境调整后接入 CI 或周巡检（13.4）。

```bash
#!/usr/bin/env bash
# security-baseline-check.sh —— 附录 A 基线巡检（只读，不做任何变更）
PASS=0; FAIL=0
check() {  # check "描述" 命令 —— 退出码 0 = PASS
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then PASS=$((PASS+1)); echo "PASS  $desc"
  else FAIL=$((FAIL+1)); echo "FAIL  $desc"; fi
}
count_fail() {  # 计数型：值应为 0
  local desc="$1" val="$2"
  if [ "$val" = "0" ]; then PASS=$((PASS+1)); echo "PASS  $desc"
  else FAIL=$((FAIL+1)); echo "FAIL  $desc（检测到 $val 处）"; fi
}

# A.3 云身份：集群内 AK/SK 明文反扫（应=0；覆盖阿里云 LTAI/AWS AKIA·ASIA 前缀）
LEAKED=$(kubectl get secret -A -o json | jq -r '.items[].data | to_entries[]?.value' 2>/dev/null \
  | while read -r v; do echo "$v" | base64 -d 2>/dev/null; done \
  | grep -cE '(LTAI[A-Za-z0-9]{12,24}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16})')
count_fail "A.3 集群内无 AK/SK 明文" "$LEAKED"

# A.3 RRSA：核心业务命名空间 SA 至少存在云身份绑定（示例查 default，按需扩列表）
BOUND=$(kubectl get sa -n default -o json \
  | jq '[.items[] | select(.metadata.annotations["alibabacloud.com/role-arn"] != null)] | length')
if [ "${BOUND:-0}" -ge 1 ]; then PASS=$((PASS+1)); echo "PASS  A.3 default 命名空间存在 RRSA 绑定（$BOUND 个）"
else FAIL=$((FAIL+1)); echo "FAIL  A.3 default 命名空间无任何 RRSA 绑定"; fi

# A.2 网络：default 命名空间存在 NetworkPolicy（default-deny 起点）
check "A.2 default 命名空间已有 NetworkPolicy" \
  bash -c 'kubectl get netpol -n default -o json | jq -e ".items | length > 0"'

# A.1 准入：全集群无 :latest 镜像（应=0）
LATEST=$(kubectl get deploy -A -o json \
  | jq -r '.items[].spec.template.spec.containers[].image' | grep -c ':latest$')
count_fail "A.1 无 :latest 镜像引用" "$LATEST"

# A.1 准入：Deployment 声明 runAsNonRoot（抽查全量，应全部为 true）
check "A.1 Deployment 全部声明 runAsNonRoot" \
  bash -c 'kubectl get deploy -A -o json | jq -e "[.items[].spec.template.spec.securityContext.runAsNonRoot] | all(. == true)"'

# A.6 审计：审计日志采集组件在位（ACK 托管审计部署于 kube-system；名称以实际组件为准）
check "A.6 集群审计日志组件在位" \
  bash -c 'kubectl get deploy,ds -n kube-system -o json | jq -e "[.items[].metadata.name] | any(test(\"audit\"; \"i\"))"'

echo "----------------------------------------"
echo "汇总：PASS=$PASS FAIL=$FAIL  （FAIL>0 按附录 A 对应节处置；本脚本为只读示例，接入 CI 前先在测试集群验证判定条件）"
```

用法：`./security-baseline-check.sh | tee baseline-report.txt`——报告随台账归档（12.4），趋势异常（如 LATEST 计数上涨）直接开整改项。墨丘里商城 demo-prod 集群的一次典型输出（能想象输出，才算会用）：

```text
PASS  A.3 集群内无 AK/SK 明文
FAIL  A.1 无 :latest 镜像引用（检测到 3 处）   ← payment-api 三个 Deployment 还挂着 :latest，当场开整改项
汇总：PASS=5 FAIL=1  （FAIL>0 按附录 A 对应节处置…）
```
