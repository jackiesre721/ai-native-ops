# 附录A 云原生与AI原生生产安全基线
<!-- 附录 ｜ 清单式落地（无新知识·无新组件） ｜ 状态：正文写作中 -->

> 定位锁死：纯落地检查清单与最小实施方案，不讲解安全理论、不引入新安全组件。每类安全主题统一按四栏组织：**风险说明 → 最小配置 → 验证方法 → 常见错误**。

> **内容边界锁死**：附录仅复用正文知识点（RBAC/NetworkPolicy/Secret/镜像/运行时等），用于落地验证，绝不引入正文不存在的新技术、新平台、新架构。

---

## A.1 RBAC最小权限管控

- **风险说明**：默认/过度授权（cluster-admin 滥用、宽泛 RoleBinding）导致越权操作、误删生产、凭据泄露后横向移动。RBAC 失控是集群被攻破后影响面扩大的主因。
- **最小配置**：
  - 按命名空间 + 角色授予最小权限，禁用 cluster-admin 给业务 ServiceAccount。
  - CI/CD 用专用受限 ServiceAccount（仅所需 namespace 的所需动词）。
  - 用户认证走 OIDC/SSO，禁用静态 token/证书长期凭证。
  - 定期审计 RoleBinding/ClusterRoleBinding，清理过期/过宽授权。
- **验证方法**：
  - `kubectl auth can-i --list --as=<sa>` 验证 ServiceAccount 实际权限。
  - 用 RBAC 审计工具（如 rbac-lookup/rbac-audit）扫描过宽授权。
  - 定期权限审计报告，评审异常授权。
- **常见错误**：
  - 给业务 SA 绑 cluster-admin（图省事）。
  - 用通配符 `verbs: ["*"] resources: ["*"]`。
  - 静态 token 长期不轮换。
  - 离职/换岗不清授权。

---

## A.2 NetworkPolicy网络隔离

- **风险说明**：默认全互通，任何 Pod 可达任何 Pod，被攻破后横向移动无阻；dev/qa 同集群互踩；AI 推理接口暴露给非授权服务。
- **最小配置**：
  - 默认拒绝（default deny）入站/出站，按需白名单放行。
  - 按命名空间/标签分段隔离（dev/qa/prod、AI 服务组、数据层）。
  - AI 推理接口仅授权调用方可达（标签选择器）。
  - 出站限制（仅允许所需外部端点，防数据外泄）。
- **验证方法**：
  - 部署 NetworkPolicy 后，用测试 Pod 验证"该通的结合、该断的断开"。
  - 用网络可达性测试工具验证隔离生效。
  - CNI 支持 NetworkPolicy（确认所选 CNI 支持，8 章）。
- **常见错误**：
  - 写了 Policy 但默认未 deny，策略形同虚设。
  - 标签写错，隔离不生效或误断。
  - CNI 不支持 NetworkPolicy，策略不报错但不生效。
  - 只管入站不管出站，数据外泄风险。

---

## A.3 Pod安全与Secret治理

- **风险说明**：特权容器/hostPath/root 运行导致容器逃逸；Secret 明文进 Git 泄露；etcd 明文存储 Secret（默认未加密）。
- **最小配置**：
  - Pod Security Standards（restricted）：非 root、drop 所有 capabilities、禁 privileged/hostPath/hostNetwork。
  - Secret 不进 Git，用 External Secrets Operator 从 KMS/Vault 拉取（10.5 节）。
  - 启用 etcd Encryption at Rest（EncryptionConfiguration），Secret 在 etcd 加密。
  - CI 构建期 secret 走 protected/masked Variables，运行时走 ESO+KMS。
- **验证方法**：
  - 准入层强制 Pod Security Standards（restricted），违规 Pod 被拒。
  - 扫描 Git 仓库无明文 Secret（secret 扫描工具）。
  - 验证 etcd 中 Secret 已加密（导出检查）。
  - ESO 拉取链路验证（ExternalSecret → Secret 正确生成）。
- **常见错误**：
  - 为调试开 privileged/hostPath 不关。
  - Secret 为图方便进 Git（10.5 案例）。
  - 未启用 etcd 加密，Secret 明文落盘。
  - CI 与运行时 secret 边界不清（2.2/16 章 Variables vs Secret）。

---

## A.4 镜像与容器运行时安全

- **风险说明**：臃肿镜像带攻击面（编译工具/源码/secrets 入镜像）；用 `latest`/未签名镜像导致供应链风险；运行时无隔离。
- **最小配置**：
  - 多阶段构建 + 精简基础镜像（distroless/alpine），非 root 运行（2.3 节）。
  - 镜像 digest 锁定，禁 `latest` 进生产（2.1 节）。
  - 镜像漏洞扫描 + 高危阻断发布（2.2 节）。
  - 运行时遵循 Pod Security restricted（A.3）。
- **验证方法**：
  - CI 校验镜像无 `latest` + digest 锁定。
  - 漏洞扫描报告，高危 CVE 阻断。
  - 镜像体积/层数上限 CI 校验（2.3）。
  - 准入校验镜像来源（仅企业仓库，2.4 节）。
- **常见错误**：
  - 单阶段构建，运行镜像含编译工具/源码/secrets。
  - 用 `latest` 导致漂移（2.1 案例）。
  - 扫描但不阻断，CVE 带病上线（2.2 案例）。
  - 从公网任意仓库拉镜像（来源不可信）。

---

## A.5 AI模型资产与推理接口安全

- **风险说明**：模型资产（高价值）被未授权访问/窃取；推理接口被滥用（刷接口盗算力/数据投毒/越权推理）；模型版本被篡改。
- **最小配置**：
  - 模型仓库权限管控 + 版本不可变（2.4 节思路用于模型仓库）。
  - 推理接口鉴权（API key/OIDC）+ 限流（防刷接口盗算力）。
  - 推理输入校验（防提示注入/越权指令的工程化校验，非算法展开）。
  - 模型版本签名/校验（部署前校验模型完整性，防篡改）。
- **验证方法**：
  - 推理接口无鉴权访问被拒。
  - 限流验证（超频请求被限）。
  - 模型版本校验链路（部署前校验签名/完整性）。
  - 模型仓库权限审计（仅授权方可拉取/推送）。
- **常见错误**：
  - 推理接口无鉴权裸暴露（被盗刷算力，17.5 成本失控）。
  - 无限流，被恶意刷接口。
  - 模型版本不校验，可被篡改上线。
  - 模型仓库权限过宽，模型可被未授权拉取。

---

## A.6 AI负载权限与审计闭环

- **风险说明**：AI 负载（GPU 资源/模型/数据）权限失控——谁用了多少算力/调用了什么模型/推理了什么数据，无审计；滥用算力/违规推理不可追溯。
- **最小配置**：
  - AI 负载 ServiceAccount 最小权限（A.1）+ GPU 资源配额（17.2）。
  - 推理调用审计日志（谁/何时/调用什么模型/输入摘要/资源消耗）。
  - 算力使用审计（GPU 配额消耗按 namespace/团队，17.2/14.3）。
  - 审计日志集中存（Loki，12 章）+ 不可篡改 + 定期审。
- **验证方法**：
  - 审计日志完整性（推理调用/算力消耗可追溯）。
  - 审计日志集中存 Loki + 访问控制。
  - 定期审计报告（异常调用/算力滥用）。
  - 越权推理/算力超用可定位到主体。
- **常见错误**：
  - 推理调用无审计，滥用不可追溯。
  - 算力消耗无审计，被盗用不知。
  - 审计日志散落/可篡改，不可信。
  - 无定期审计，异常长期未发现。
