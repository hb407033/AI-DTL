# AI-DTL 品牌统一与私有仓库发布计划

**Goal:** 合并已有实现到 main，采用用户提供的 Logo 和最终中文名称，验证后推送到用户指定的私有仓库。

**Architecture:** 只改变品牌资源、面向用户的显示名称和文档，不改教学逻辑、身份协议、Bundle ID、数据库目录和包导入。原图保留为统一品牌源，Web 和原生端复用。

**Tech Stack:** SwiftUI / PencilKit、Fastify / HTML、TypeScript、Git / GitHub。

## 确认的品牌

- 简称：AI-DTL。
- 中文：AI 学科心智学习系统。以用户本轮纠正为准，严格保留「心智」。
- 英文：AI-Powered System for Disciplinary Thinking and Learning。
- Logo：本轮用户提供的透明 PNG，保留原图，不重画、不替换为第三方素材。
- 教育理念保持「孩子先独立建模，AI 根据证据逐级介入，并最终退出」，不添加效果承诺。

## 执行顺序

- [x] 保存已有 Claude 交接文档，验证并以 `git merge --ff-only feat/phase-0-native-ipad-gates` 合入 main；在 main 基础新建 `codex/ai-dtl-branding` 编辑，避免直接提交保护分支。
- [x] 将原图保存为 `assets/brand/ai-dtl-logo.png`；加入 README 和品牌说明。原生两工程增加资源、显示名称和品牌头部；Web 控制台内嵌原图与标题。编写资源/品牌回归检查。
- [x] 产品名称固定为「心智」，保留技术标识符与历史证据；更新 Claude 交接入口为合并后的 main，避免过期分支指令。
- [x] 运行 TS 测试与类型检查，核对实际 Web 页面，完成两原生工程的构建和资源字节核对；独立复核品牌遗漏和资源加载。
- [ ] 原生品牌单测和 UI 测试在模拟器实际运行，以及原生截图验收（测试已编译，启动阶段受环境负载影响，未执行断言；不声明通过）。
- [x] 对将上传的受版本控制文件及 main 历史做不泄露内容的敏感文件检查，未发现真实家庭结果、音频、数据库和明显凭据；规则扫描不能保证排除所有形式的敏感信息。
- [x] 提交品牌分支，快进合并到 main。配置指定仓库为 origin，普通 push main（不强推），核验远端 main SHA 和 private 状态。

## 发布边界

目标 `https://github.com/hb407033/AI-DTL.git` 已通过 GitHub CLI 确认 private、empty、当前账号 ADMIN；推送前再次确认远端状态。用户已授权此次合并和推送，不包含部署服务、修改 Codex 鉴权、公开仓库或付费操作。保留现有学习系统尚未完成的验收与 Codex realtime BLOCKED 说明。

## 本次验证记录

- 2026-09-13 13:25：`pnpm test` 57 文件 / 459 项通过；`pnpm typecheck` 通过；`git diff --check` 通过。
- 原生两工程使用 `sources` 下的文件夹资源引用，避开无效的 target 顶层 `resources` 写法，并保持用户 PNG 不被构建期优化改写。Logo SHA256：`d5c780d649b2678a1cd59619a0879afa906a5a0a841de4379758d602b17e494d`。
- 本次不新增方形 AppIcon，不以横版原图强行拉伸；不宣称真机或实时语音已验收。
- 用户分享方案的架构/开源分析见 `../specs/2026-09-13-open-framework-comparison.md`，仅为建议，不改变既有技术栈、仓库私有状态或许可证。
- 首次推送成功：品牌及分析提交 `c8643ae` 已合入并推送 `origin/main`，GitHub 默认分支为 main，仓库仍 private。本行作为后续文档提交保存；最新提交以远端 main 为准。
- 根 agent 再次执行两工程 `build-for-testing`，均退出 0；核对两安装包 Logo 与原图 SHA256 一致。原生测试断言仍未实际运行，不把构建成功当作测试通过。
