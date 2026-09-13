<p align="center">
  <img src="assets/brand/ai-dtl-logo.png" alt="AI-DTL" width="480" />
</p>

# AI 学科心智学习系统

**AI-DTL · AI-Powered System for Disciplinary Thinking and Learning**

孩子先独立建模，AI 根据证据逐级介入，并最终退出。

一个面向家庭的、以学科思维成长为目标的学习系统。我们希望孩子逐步像数学家、文学家一样提出问题、建立表示、检验想法，而不只是得到一道题的答案。

## 当前状态

项目处于 **数学 Alpha 工程验证阶段**，尚不是完整课程产品。

- 已有：原生 iPad 单屏交互、PencilKit 笔迹保存与恢复、教学状态机、分级提示、独立迁移、家长控制台、本地成长账本及孩子的同意／异议／删除闭环。
- 当前教学样例：小数乘法固定薄切片，而非所有学科、题型或课程已接入。
- 实时语音：优先采用 Codex realtime；最近一次准入验证被当前身份的 API key auth 要求阻断。现有脚本回放、家长接管和系统朗读不等于 Codex 实时语音已接通，不自动更换模型或鉴权路线。
- 待验证：真实 iPad / Apple Pencil 的延迟、录放音、家庭网络与孩子的实际学习体验。模拟器和自动测试不能代替真机或教学效果验收。

## 架构与目录

| 层次 | 职责 | 位置 |
| --- | --- | --- |
| 学科与教学 | 教学状态机、提示预算、证据、区分任务、学科插件 | `packages/learning-kernel`、`packages/plugin-math` |
| 画布与交互 | SwiftUI、PencilKit 原笔迹、独立的 Agent 语义层 | `apps/ipad/ScholarPad` |
| 成长记忆 | 本地 SQLite、成长账本、审阅、异议、删除与趋势 | `packages/learning-kernel/src/growth` |
| 家庭宿主 | Mac mini 上的会话编排、HTTP/WS、家长控制台 | `apps/agent-host` |
| 接口契约与验证 | 会话契约、设备联调、Codex 准入探针 | `packages/*-contracts`、`apps/ipad/ScholarPadProbe`、`tools` |

学习档案保存在家中 Mac；iPad 作为触摸、笔迹与交互终端。原始笔迹与 AI 语义画布分离，AI 不直接改写孩子原笔迹。家庭链路使用 HTTP/WS；家长控制台保持本机访问与凭据校验。本地存储不表示模型调用离线，未来接入模型仍需明确发送内容。

## 开发与验证

需要 Node.js ≥ 22、项目声明的 pnpm 版本；原生端需要 Xcode、iOS 18+ SDK 和 XcodeGen。具体依赖以 `package.json`、锁文件和原生工程定义为准。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

原生工程从定义生成，不提交生成的 `.xcodeproj`：

```sh
cd apps/ipad/ScholarPad
xcodegen generate
open ScholarPad.xcodeproj
```

宿主启动：

```sh
pnpm host
```

默认儿童通道 `ws://<Mac 局域网地址>:8788/session`，家长控制台 `http://127.0.0.1:8789/parent`。默认数据目录 `~/.ai-scholar`；测试或联调请用 `AI_SCHOLAR_DATA_DIR` 指向独立目录，勿拿真实学习库做破坏性测试。不要将家长凭据粘贴到聊天或提交到 Git。

## 接手入口

- [当前交接与未完成项](docs/handoffs/2026-09-13-claude-handoff.md)
- [iPad 到货联调清单](docs/handoffs/2026-09-13-ipad-arrival-checklist.md)
- [架构设计](docs/superpowers/specs/2026-08-30-ai-scholar-learning-system-design.md)
- [成长账本验收映射](docs/superpowers/plans/2026-09-13-growth-ledger-acceptance-matrix.md)——映射不是全项通过。
- [品牌规范](assets/brand/README.md)

本项目当前发布到所有者指定的私有仓库。本次上传不代表公开开源或部署到真实家庭设备。
