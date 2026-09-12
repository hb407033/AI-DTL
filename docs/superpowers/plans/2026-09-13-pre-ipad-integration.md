# iPad 到货前联调实施记录

## 范围与先后

用户已授权继续验收映射、Codex 实时链路、PencilKit 上传/恢复/预览。实际 iPad Pro 尚未到货；本轮不把模拟器、回环网络或假服务计为真机验收。沿用当前工作分支和原生 SwiftUI/PencilKit、本地 HTTP/WS、Mac SQLite 架构，不合并、推送或修改真实家庭数据。

- [x] 1. 对成长账本 §13 的 206 条逐项建立真实测试证据映射，标出缺口；映射完成不等于全部验收通过。
- [x] 2. 重测本机 Codex 实时准入；补齐可自动验证的音频探针与错误诊断，不换鉴权路线。完整语音链路仍 BLOCKED。
- [x] 3. 原始笔迹和预览同库持久化，接入原生缓存、上传、恢复与家长预览；覆盖幂等、断线和删除不复活（本地/模拟器范围）。
- [x] 4. 独立复核修改，运行相关测试和类型检查，输出真机到货验收步骤。

## 基线

2026-09-13：工作区初始干净，分支 `feat/phase-0-native-ipad-gates`。本轮实跑 `pnpm test`：53 文件、443 测试通过。

## Codex 准入实测

- 本机 `codex-cli 0.153.4`，生成 v2 schema SHA-256 与项目固定契约匹配。
- 执行 `pnpm gate:codex --trials 1`，在实时启动阶段收到 `realtime conversation requires API key auth`，结果为 **BLOCKED**，未得到输出音频。
- 本地原始报告：`validation/results/codex/codex-2026-09-12T16-58-09-447Z.json`（UTC 文件名，目录不入库）。
- 不把此结果推广为所有 Codex 产品/版本的结论；它只证明当前本机 CLI 的当前订阅身份路径被拒绝。不会搜索凭据、切换 API Key 或换第三方模型。
- 改进探针后再次执行同一条 1 回合命令，结果仍为相同 BLOCKED；新报告 `validation/results/codex/codex-2026-09-12T17-10-05-231Z.json`。没有输出音频，也没有进入音频输入步骤。
- 官方通用说明：[Codex App Server](https://learn.chatgpt.com/docs/app-server)。通用 app-server 可嵌入不等于实验实时会话已经获准，当前准入以实际错误为准。

## 已完成的到货前工作

### 验收映射

[206 条矩阵](2026-09-13-growth-ledger-acceptance-matrix.md) 经独立结构与抽样断言复核：96 covered、86 partial、20 missing、4 device-pending。编号连续无重复，279 个引用路径及行号有效。covered 仅表示该条断言覆盖，不是阶段最终签字。确定性属性测试、动态规则 ID 集合校验按实际保证审查，不机械要求重复源码扫描。

### Mac 音频探针

- 支持明确确认的成人/合成 WAV，24kHz 单声道 PCM16、最多 30 秒，分块 `appendAudio` 和 1.5 秒尾部静音。
- 非法或缺失输入在启动前阻断；`--dry-run` 只握手，不能产出语音门禁 PASS。
- 通知按线程隔离，先监听后请求，每回合单独线程；身份拒绝不重试剩余回合。
- 首音频必须是有效 PCM，停止期间异步错误也记为失败；整回合 90 秒截止，stop 最多额外 5 秒。
- 探针独立评审修复了缺少音频路径静默走文字、无效音频假成功、停止期间错误漏报。16 项本地探针测试与类型检查通过，不涉及真实模型音频。

### 原始笔迹的契约

原始 PKDrawing 和 PNG 预览同库 BLOB 保存，服务端分配不可变版本、相同 revision 幂等、内容不同拒绝。原笔迹端口不交给 Agent，Agent 语义层仍独立。家长预览复用已有家长通道。

当前单位是整幅会话画布，不是各 run 单独原画布。首次保存后归属稳定；同会话任一作品被删除时，共享画布也纳入预览和事务清理。离线 iPad 在重新联机收到 410 后清空对应缓存并保留墓碑；不声称能即时抹除未联网设备。

到货步骤与剩余体验门禁见 [真机验收清单](../../handoffs/2026-09-13-ipad-arrival-checklist.md)。

## 最终验证与评审

- `pnpm test`：57 个文件、458 项通过；`pnpm typecheck` 全工作区通过；`git diff --check` 通过。
- Swift：全部 `ScholarPadTests` + `MemoryAssentSmokeUITests` + `ChildRightsSmokeUITests`，**40 项通过、0 失败、0 跳过**。包括 10 个原始笔迹相关测试。主 agent 另读取 xcresult summary 核实数量和 Simulator 平台。
- xcresult：`/Users/houbin/Library/Developer/Xcode/DerivedData/ScholarPad-essaebgfwesazhgzppsposuuyltg/Logs/Test/Test-ScholarPad-2026.09.13_01-16-28-+0800.xcresult`。
- 命令：`xcodebuild -project apps/ipad/ScholarPad/ScholarPad.xcodeproj -scheme ScholarPad -destination 'platform=iOS Simulator,id=99771417-7810-4EAF-BCCB-51C0C6F195A0' -parallel-testing-enabled NO -only-testing:ScholarPadTests -only-testing:ScholarPadUITests/MemoryAssentSmokeUITests -only-testing:ScholarPadUITests/ChildRightsSmokeUITests test -quiet`。
- 服务端不仅使用 inject：真实回环 HTTP → 临时文件 SQLite → 关闭/重开宿主 → 下载字节一致。测试数据与正式家庭数据隔离。
- 规格和代码质量分别复核。修复并补回归：清空未保存、410 后晚到 200 复活、共享画布删除遗漏、同时间戳作品导致画布归属漂移；音频探针修复见上文。
- 一次 Swift 测试宿主启动卡住，终止该次运行后禁用并行重跑；不以该次卡住结果冒充测试通过。最终通过证据如上。

## 仍未完成（不能随复选框关闭）

1. 206 条映射已完成，但其中 partial/missing 的证据与测试缺口未在本次全部补齐，不能宣布成长账本全部终验通过。
2. Codex 当前订阅身份实时启动仍被拒绝；没有实际 `appendAudio` 成功、模型音频回传或 iPad 全链路证据。此次只完成准入重测和探针准备，未实现并验收正式儿童端的 Codex 双向音频桥接。
3. 真 iPad、Pencil 延迟、录放音、家庭网络中断、实际教学体验未验收；家长浏览器的预览视觉也尚未人工确认。
4. 画布按会话保存；现有家长 JSON 导出保留索引和元数据，不是新增 BLOB 的独立打包导出工具。

## 必须等真机的项目

真实录音权限、麦克风/扬声器及回声、Apple Pencil 延迟和手感、局域网连通与中断恢复、iPad 到 Mac 的实际音频首包与打断延迟、孩子的教学体验。硬件到货后也不能绕过 Codex 准入 BLOCKED。
