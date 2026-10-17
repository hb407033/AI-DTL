# 主机发现与离线撤销补同步

**Goal:** iPad 自动找到原学习主机；撤下提示立即生效，断网和重启后可靠补同步。

**Architecture:** Mac Bonjour 广播 `_ai-dtl._tcp`，healthz 返回持久 hostId。iPad 保留手填入口，不在对话中切换主机。撤销事件先原子落盘，再按原事件 ID、最新 revision 重试；只接受原主机确认，不触发模型生成。

**Tech Stack:** SwiftUI / Foundation NetService，TypeScript / Fastify，macOS dns-sd。

当前工作区串行实施，保留其他改动，不自动提交。

## 验收步骤

- [x] 主机发现：测试同目录 hostId 稳定、不同目录隔离、healthz 标识；实现 Bonjour 子进程生命周期。
- [x] iPad 发现：校验 mode / protocol / hostId，唯一候选自动选取，多个候选由家长选择，已选主机优先；正在对话不改地址。
- [x] 离线队列：测试重启保留、旧墓碑迁移、失败保留、同 ID 重试、其他主机禁止写入、冲突重新取 revision、撤销不复活。
- [x] 生命周期接线：前台每 15 秒及地址/作品变化时补同步；后台停止；测试缓存与家庭缓存隔离。
- [x] 运行相关 TS / Swift 测试、真机构建安装；记录实测和不能验证的边界。
- [x] 真机 Bonjour 发现、自动填址界面、经 USB 地址的离线故障注入：共 12 项通过（18:44 补验）。
- [ ] 关闭其他网络后的纯 USB Bonjour、实体拔插线：未执行，不与故障注入测试混同。

相关文件：`apps/agent-host/src/ai/host-discovery.ts`、`learning-tutor.ts`；iPad `Session/HostDiscovery.swift`、`ScaffoldRevocationOutbox.swift`、`LineScaffoldModel.swift`、`LearningWorkspaceView.swift`；对应测试和 `project.yml`。

验证命令：`pnpm --filter @ai-scholar/agent-host exec vitest run test/host-discovery.test.ts`；`pnpm --filter @ai-scholar/agent-host typecheck`；Xcode ScholarPadTests 定向运行 HostDiscoveryTests、ScaffoldRevocationTests、LineScaffoldTests。
