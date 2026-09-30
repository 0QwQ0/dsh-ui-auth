# 文档导航（按角色）

> **面向：**所有读者。

本仓库的文档按**读者角色**组织。先在下表找到你的角色，再读对应的文档——不必从头读全部。

| 你是谁 | 先读 | 再读 | 不必读 |
|---|---|---|---|
| **第一次用这个插件的用户** | [README](../README.md) | [CHANGELOG](../CHANGELOG.md) 中你所用版本的条目 | 设计/审计类文档 |
| **部署者 / 运维** | [README](../README.md) 的安装与首次登录 | [OPERATIONS](OPERATIONS.md) | 模块内部细节 |
| **安全审计员 / 安全决策者** | [SECURITY](SECURITY.md) | [SECURITY-VERIFICATION](SECURITY-VERIFICATION.md)（证据）、[RBAC 设计](RBAC-MODEL-PROFILES.md) | 安装步骤 |
| **升级 / 集成者** | [0.2.0 兼容性](DSH-0.2.0-COMPATIBILITY.md) | [0.1.5 兼容性（历史）](DSH-0.1.5-COMPATIBILITY.md) | 运维细节 |
| **开发者 / 贡献者** | [ARCHITECTURE](ARCHITECTURE.md) | [CONTRIBUTING](../CONTRIBUTING.md)、[ROADMAP](ROADMAP.md) | 商店材料 |
| **DSH STORE 审核员** | [STORE-EVIDENCE](STORE-EVIDENCE.md) | [SECURITY](SECURITY.md) | 使用指南 |
| **维护者（发布）** | [PUBLISHING](PUBLISHING.md) | [ROADMAP](ROADMAP.md) | — |

## 全部文档一览

| 文档 | 角色 | 一句话说明 |
|---|---|---|
| [`README.md`](../README.md) | 首次使用者 | 这个插件解决什么问题、怎么装、怎么登录、日常怎么用 |
| [`CHANGELOG.md`](../CHANGELOG.md) | 所有用户 | 每个版本的变化、破坏性变更与升级注意事项 |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | 贡献者 | 开发环境、测试、提交与文档规范 |
| [`docs/INDEX.md`](INDEX.md) | 所有读者 | 本文档（角色导航） |
| [`docs/OPERATIONS.md`](OPERATIONS.md) | 部署者 / 运维 | 环境变量、数据与持久化、备份恢复、升级回滚、排障 |
| [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) | 开发者 | 模块地图、请求流、数据模型、扩展点、测试策略 |
| [`docs/SECURITY.md`](SECURITY.md) | 审计员 | 威胁模型、信任边界、加密与密钥、权限矩阵、残余风险、审计清单 |
| [`docs/SECURITY-VERIFICATION.md`](SECURITY-VERIFICATION.md) | 审计员 | 安全验证报告（用例矩阵、发现与修复、复现命令） |
| [`docs/RBAC-MODEL-PROFILES.md`](RBAC-MODEL-PROFILES.md) | 设计 / 评审 | 多用户模型与密钥隔离的设计、不变量与存储布局 |
| [`docs/DSH-0.2.0-COMPATIBILITY.md`](DSH-0.2.0-COMPATIBILITY.md) | 升级 / 集成者 | 当前支持的 DSH 版本矩阵、端点面、实测方法 |
| [`docs/DSH-0.1.5-COMPATIBILITY.md`](DSH-0.1.5-COMPATIBILITY.md) | 历史归档 | 0.6.x 时代的适配记录，仅供检索 |
| [`docs/STORE-EVIDENCE.md`](STORE-EVIDENCE.md) | 商店审核员 | 上架所需的声明与证据 |
| [`docs/PUBLISHING.md`](PUBLISHING.md) | 维护者 | 发版流程、上架合规、保真核验 |
| [`docs/ROADMAP.md`](ROADMAP.md) | 关注进度者 | 已完成 / 进行中 / 计划，以及验收后的修复台账 |

## 文档写作约定

新增或改动文档时请遵守：

1. **每份文档开头标明「面向」**（一行引用块），读者不必猜；
2. **角色优先于主题**：新的内容先想"谁需要它"，再决定放进哪份文档；
3. **本表同步**：新增文档要在上表登记，否则等于不存在；
4. **不重复**：同一事实只在一处详解，其它地方给**摘要 + 链接**；
5. **可执行**：运维/审计类内容要给**可复制的命令**，而不是"请自行确认"。