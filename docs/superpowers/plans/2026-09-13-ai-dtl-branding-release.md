# AI-DTL 品牌统一与私有仓库发布计划

**Goal:** 合并已有实现到 main，采用用户提供的 Logo 和最终中文名称，验证后推送到用户指定的私有仓库。

**Architecture:** 只改变品牌资源、面向用户的显示名称和文档，不改教学逻辑、身份协议、Bundle ID、数据库目录和包导入。原图保留为统一品牌源，Web 和原生端复用。

**Tech Stack:** SwiftUI / PencilKit、Fastify / HTML、TypeScript、Git / GitHub。

## 确认的品牌

- 简称：AI-DTL。
- 中文：AI 学科新质学习系统。用户消息前段的旧「心智」名称被最后明确命名覆盖。
- 英文：AI-Powered System for Disciplinary Thinking and Learning。
- Logo：本轮用户提供的透明 PNG，保留原图，不重画、不替换为第三方素材。
- 教育理念保持「孩子先独立建模，AI 根据证据逐级介入，并最终退出」，不添加效果承诺。

## 执行顺序

- [ ] 保存已有 Claude 交接文档，验证并以 `git merge --ff-only feat/phase-0-native-ipad-gates` 合入 main；在 main 基础新建 `codex/ai-dtl-branding` 编辑，避免直接提交保护分支。
- [ ] 将原图保存为 `assets/brand/ai-dtl-logo.png`；加入 README 和品牌说明。原生两工程增加资源、显示名称和品牌头部；Web 控制台增加同源品牌资源与标题。编写资源/品牌回归检查。
- [ ] 更新正式设计/计划的产品名称，保留技术标识符与历史证据；更新 Claude 交接入口为合并后的 main，避免过期分支指令。
- [ ] 运行相关测试、类型检查、原生构建/品牌测试并查看实际界面；独立复核品牌遗漏和资源加载。
- [ ] 对将上传的受版本控制文件及历史做不泄露内容的敏感文件检查，排除真实家庭结果、音频、数据库和凭据。
- [ ] 提交品牌分支，快进合并到 main。配置指定仓库为 origin，普通 push main（不强推），核验远端 main SHA 和 private 状态。

## 发布边界

目标 `https://github.com/hb407033/AI-DTL.git` 已通过 GitHub CLI 确认 private、empty、当前账号 ADMIN；推送前再次确认远端状态。用户已授权此次合并和推送，不包含部署服务、修改 Codex 鉴权、公开仓库或付费操作。保留现有学习系统尚未完成的验收与 Codex realtime BLOCKED 说明。
