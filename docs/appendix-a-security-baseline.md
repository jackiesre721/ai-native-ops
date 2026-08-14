# 附录A 云原生与AI原生生产安全基线
<!-- 附录 ｜ 清单式落地（无新知识·无新组件） ｜ 状态：终审中 -->

> 定位锁死：纯落地检查清单与最小实施方案，不讲解安全理论、不引入新安全组件。每类安全主题统一按四栏表组织：**维度 → 基线要求 → 落地方式 → 检查方法**，每条基线落到可执行的配置片段、命令或云服务名（阿里云主参考、AWS 全程对照）。

> **内容边界锁死**：附录仅复用正文知识点——云身份联邦 RRSA/IRSA（见 4.2）、镜像供应链（见 2 章）、RBAC 与资源配额（见 7.4）、NetworkPolicy 与安全组（见 8.1）、告警通道（见 13.1）、GPU 与模型资产（见 17 章），用于落地验证，绝不引入正文不存在的新技术、新平台、新架构。CIS 详细加固、OPA 深度归 V2。

---

## A.1 多租户RBAC最小权限与资源配额隔离

> **风险**：cluster-admin 滥用与宽泛 RoleBinding 是集群被攻破后影响面扩大的主因；共享集群再叠加无配额，越权与互害双层失守（见 7.4）。

| 维度 | 基线要求 | 落地方式 | 检查方法 |
|---|---|---|---|
| 授权粒度 | 按命名空间+角色授最小权限；cluster-admin 仅限平台团队少数人 | Role/RoleBinding（namespace 级）；CI/CD 用专用 ServiceAccount | `kubectl auth can-i --list --as=<sa> -n <ns>` |
| 多租户分层 | 平台/业务/算法三层权限边界（下表） | 每层一份 Role 模板进基础 chart（见 9 章），新建 namespace 默认下发 | 越层/危险动词 `can-i` 反向验证为 no |
| 资源配额与强隔离 | 每 namespace 配 ResourceQuota+LimitRange；生产/非生产强隔离靠分集群或专用节点池，不靠配额 | 复用 7.4 三层规范（配额/兜底/单容器）+节点池标签/污点 | `kubectl -n <ns> describe resourcequota`；非生产 Pod 不进生产节点池 |
| 用户认证与授权回收 | 人一律 OIDC/SSO，禁静态 token/证书长期凭证；RoleBinding 定期清理过期/过宽授权 | ACK 对接 RAM/SSO；权限矩阵入 Git 季度评审（2.4 同款） | 无长期 token 存活；过期/过宽绑定清单为零 |

多租户三层模型（评审 R14 补齐）：

| 层 | 权限范围 | Role 权限要点 |
|---|---|---|
| 平台团队 | 全集群 | cluster-admin 仅少数值班持有；节点池/集群升级走云控制台+RAM 审批（见 4.4） |
| 业务团队 | 本团队 namespace | 工作负载读+滚动重启/扩缩容写；禁改 RBAC/Quota/NetworkPolicy |
| 算法团队 | GPU namespace 限定使用 | 推理 Deployment/Job 读写、PVC 读；GPU 用量由配额封顶（见 17.2）；禁碰节点池与集群级资源 |

落地制品——业务团队开发者最小 Role+RoleBinding（算法团队同款模式，叠加 GPU 配额）：

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: team-developer
  namespace: team-payment        # namespace = 团队边界（见 7.4）
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

> **风险**：云网络默认"VPC 内互通、Pod 全互通"——横向移动无阻；公网入口不收敛则纵向也无阻（见 8.1）。

| 维度 | 基线要求 | 落地方式 | 检查方法 |
|---|---|---|---|
| 公网入口收敛 | 公网只经 WAF→SLB/ALB 进入；节点不对公网暴露业务端口；SSH 22 不对公网 | SLB 仅开 443/80，后端走内网；WAF 回源白名单；SSH 走堡垒机/云助手 | 安全组审计命令核对无业务端口/22 对 0.0.0.0/0 |
| 节点间最小化 | 节点安全组仅放行所需网段与端口（Terway Pod 直通 VPC，见 8.1） | 收紧集群安全组；控制面访问由 ACK 托管安全组管理（以官方文档为准） | 跨节点 Pod 通、公网端口扫描不通 |
| Pod 横向隔离 | namespace 先默认拒绝、再按需白名单 | NetworkPolicy（下方 YAML）；Terway 需先开启 NetworkPolicy（见 8.1） | busybox 探测 Pod 验证该通该断（非网关 ns 内 `wget --timeout=3` 业务端口应超时失败） |
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

NetworkPolicy 制品（default-deny 双向+按需放行；前提：Terway 已开启 NetworkPolicy，见 8.1）：

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

> **常见错误**：写了 Policy 但未先 default-deny；Terway 未开启 NetworkPolicy，策略静默不生效（见 8.1 头号坑）；标签 typo 策略空转；只管入站不管出站。

---

## A.3 Pod安全、Secret治理与云身份凭据

> **风险**：特权容器/hostPath/root 运行是容器逃逸三件套；Secret 明文进 Git；AK/SK 长期凭据塞进集群——泄露面从"一个应用"扩大到"整个云账号"（见 4.2 的 17 分钟清桶案例）。
> **AK/SK 零容忍（一行）**：所有 Pod 云身份必须走 RRSA/IRSA 临时凭据（见 4.2），本节对其做"全走检查"。

| 维度 | 基线要求 | 落地方式 | 检查方法 |
|---|---|---|---|
| Pod 准入 | namespace 打 PSA 标签：baseline 起步强制、restricted 为目标 | Pod Security Admission 标签（下方 YAML），ACK/EKS 托管控制面内置 | 违规 Pod 被 apiserver 直接拒绝 |
| 运行身份 | 非 root、drop 全部 capabilities、禁 privileged/hostPath/hostNetwork | securityContext 模板进基础 chart（15 章同款） | `kubectl get pod -o yaml` 抽查 securityContext |
| Secret 管理 | Secret 不进 Git；运行时从 KMS 拉取 | External Secrets Operator+KMS（见 10.5）；CI 侧走 protected/masked Variables（见 2 章） | Git 扫描零命中；ExternalSecret→Secret 生成正常 |
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

落地制品②——RAM 角色最小权限策略（只读模型 OSS 前缀，供 17.3 模型仓库与业务只读场景复用）：

```json
{
  "Version": "1",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["oss:GetObject", "oss:ListObjects"],
    "Resource": [
      "acs:oss:*:*:llm-models",
      "acs:oss:*:*:llm-models/models/*"
    ]
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

## A.5 AI模型资产与推理接口安全

> **风险**：模型是高价值资产——被窃取/篡改/盗刷算力，损失直接落到底层 GPU 账单（见 17.5）。

| 维度 | 基线要求 | 落地方式 | 检查方法 |
|---|---|---|---|
| 模型制品 | 模型不进镜像；OSS 版本目录一次写入不可变 | `oss://<bucket>/models/<model>/<version>/` 目录规范（见 17.3），等价镜像 digest 锁定 | 版本目录无二次修改；换模型只改 PVC 路径 |
| 只读挂载 | PV ReadOnlyMany+Retain，ossfs 只读 | OSS CSI 静态供给完整 PV/PVC（见 17.3） | 容器内写模型目录失败 |
| 仓库访问 | 模型 bucket 访问走 RRSA/只读子账号，禁 AK/SK | RAM 权限=A.3 制品②（前缀只读）；新版 OSS CSI 支持 RRSA 免密挂载（键名以官方文档为准，见 17.3） | A.3 反扫无命中；越权写被 RAM 拒绝 |
| 接口鉴权 | 推理接口禁裸暴露，API key/OIDC 鉴权 | 经 Ingress/SLB 暴露（见 8.2、17.4），网关层鉴权 | 无鉴权请求被拒（401） |
| 限流与输入校验 | 入口限流+输入工程化校验（长度/格式/黑名单，不展开算法），防刷接口盗算力 | 限流阈值按业务峰值设定；校验在网关与应用层；被盗刷的代价直接落在 GPU 成本（见 17.5） | 超频请求被限（429）；异常输入被拒且有日志 |
| 版本溯源 | 部署清单声明模型版本路径 | Helm values+ArgoCD 全链路可追溯（见 17.3、10 章） | 能回答"线上跑的是哪个模型版本" |

> **常见错误**：推理接口无鉴权裸暴露（被盗刷算力，见 17.5 成本失控）；模型目录可写（运行时可篡改）；模型散落节点本地缓存答不出线上版本（见 17.3）。

---

## A.6 审计与告警闭环：云操作审计、K8s审计与AI算力追溯

> **风险**：谁改了 RAM 策略/安全组、谁调用了模型、谁吃掉了 GPU 配额——无审计则滥用不可追溯；审计不接告警则异常长期潜伏。

| 维度 | 基线要求 | 落地方式 | 检查方法 |
|---|---|---|---|
| 云操作审计 | ActionTrail/CloudTrail 开启，管理写操作全留痕，留存 ≥180 天 | 单账号追踪投递 OSS/SLS（下方命令）+生命周期规则 180 天以上（云端默认可查询窗口约 90 天，以官方文档为准） | 抽查任一敏感操作可查到操作者与时间；生命周期规则核对 |
| K8s 审计 | API 审计日志开启 | ACK 控制台开启审计日志投递 SLS；EKS 开启 control plane logging（下方命令） | 审计日志库有近期 apiserver 事件 |
| 敏感操作告警 | RAM 策略变更/安全组变更/角色提权即告警 | ActionTrail→SLS 告警规则（事件名如 CreatePolicy、AuthorizeSecurityGroup），通道接 13.1 分级路由（P1 起步） | 演练一次变更，告警 5 分钟内触达值班 |
| 推理调用审计 | 谁/何时/调用什么模型/资源消耗，日志集中且不可篡改 | 推理网关访问日志集中 Loki（见 12.4），带模型版本与租户标签；云侧审计桶开版本控制防误删 | 异常调用可定位到主体；定期出审计报告并评审 |
| 算力审计 | GPU 配额消耗按 namespace/团队可追溯 | 配额隔离复用 17.2（卡数+共享显存 ResourceQuota）；账单分摊同 14.3 | 超用可定位团队；DCGM 指标已在 VM（见 17.2） |

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
- [ ] 每 namespace 配 ResourceQuota+LimitRange（7.4 口径），强隔离靠分集群/专用节点池？

**A.2 网络隔离**

- [ ] 安全组无 22/业务端口对 0.0.0.0/0，公网仅 WAF/SLB 443/80？
- [ ] Terway 已开启 NetworkPolicy（见 8.1），业务 ns default-deny+白名单生效，出站仅放行 DNS 与必要端点？

**A.3 Pod/Secret/云身份**

- [ ] AK/SK 零容忍：集群 Secret 与 Git 双扫描零命中，云身份全走 RRSA/IRSA（见 4.2）？
- [ ] PSA 标签生效（baseline 强制+restricted 审计），特权/hostPath 被拒？
- [ ] Secret 走 ESO+KMS（见 10.5），etcd 落盘加密已开启？

**A.4 供应链**

- [ ] 生产镜像无 `latest`，digest/不可变 tag+cosign 验签（见 2.4）？
- [ ] HIGH,CRITICAL 扫描阻断双闸门（见 2.3/2.4），拉取仅 ACR/ECR 免密？

**A.5 AI 资产**

- [ ] 模型 OSS 版本目录一次写入+只读挂载（见 17.3），访问走 RRSA/只读子账号？
- [ ] 推理接口有鉴权+限流，无鉴权访问被拒、超频被限，版本可追溯？

**A.6 审计闭环**

- [ ] ActionTrail/CloudTrail 开启且留存 ≥180 天（OSS/S3 生命周期兜底）？
- [ ] RAM 策略/安全组变更告警已接 13.1 分级通道？
- [ ] GPU 配额隔离（见 17.2）与推理调用审计可追溯到团队/主体？
