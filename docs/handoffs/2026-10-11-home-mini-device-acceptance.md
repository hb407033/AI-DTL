# 回家后 Mac mini + iPad 真机闭环验收

AI-DTL / AI 学科心智学习系统，2026-10-11。

## 结论

**本轮真机定向闭环通过，不是整个产品验收完成。** iPad 直接访问 Mac mini 的隔离宿主，题照识别、题意确认、真实 PencilKit 手势、看笔迹开场、五轮实际 ASR/教学决策/语音播报、纠错、检验、迁移及保存核对通过。普通启动的主机发现/选择/重开保留地址也通过。没有替换模型或接入新平台。

## 环境与服务

- 笔记本仓库：`/Users/houbin/Documents/Codex/2026-08-29/wo-yo`；mini 对应 `/Users/hb-mini/Documents/Codex/2026-08-29/wo-yo`。
- 双机开工及收工 HEAD 均为 `e2a14d1`，分支 `codex/ipad-arrival-plan`。原有213项未提交内容保留；关键策略、决策、探针和界面测试文件 SHA256 一致，不需要覆盖源码。本轮只新增此交接文件，未提交或批量同步既有改动。
- SSH：`hb-mini@10.10.10.6`。mini 正式端口8791原进程71071启动于10月8日，早于10月11日决策源码修改时间；检查进程确为学习宿主后 SIGTERM，按已有 `scripts/run-learning-host.sh` 使用 nohup 启动新进程33038。正式服务 `/healthz` 为 `ok / configured=true`，稳定主机ID `62a27a5d-588d-4807-8ad9-db981fdc8d81`。
- 配置只检查模型ID，没有读取/回显凭据；实际为 `qwen3.8-omni-flash-realtime`。
- 本轮没有重新启用 LaunchAgent。之前的 launchd/Documents TCC 问题未在这里解决；当前8791是手动 nohup 服务，不能宣称已验证重启自启动。Hermes等无关服务未改。
- 真机 `00008112-000509D9268A201E`（iPad Pro 11英寸第4代，iOS27.0）已连接、解锁；原 bundle `com.houbin.aischolar.pad` 原位测试安装，未卸载或清空家庭缓存。

## 实际执行

1. mini 上运行5个相关测试文件，**30项通过、0失败**：`teaching-intent-and-operations`、`workspace-teaching-decision`、`decimal-division-policy`、`workspace-natural-loop`、`workspace-voice-route`。命令：`/opt/homebrew/bin/node node_modules/vitest/vitest.mjs run --root apps/agent-host test/teaching-intent-and-operations.test.ts test/workspace-teaching-decision.test.ts test/decimal-division-policy.test.ts test/workspace-natural-loop.test.ts test/workspace-voice-route.test.ts`。
2. mini 使用现有 `probe-division-dialogue.ts --serve` 在8797提供与正式服务相同代码的隔离宿主；音频/照片夹具复制到 `/tmp/ai-dtl-home-acceptance.W6K8H1`，独立存档 `store-vFPTvW`。不向家庭作品库写合成样本。
3. 原有临时Xcode工程中的产品Swift代码与仓库逐目录比较无差异；只将临时测试的宿主从 `macbookpro.local` 改成 `hb-mini.local`。不是笔记本代理转发，也不是mock模型。
4. 真机 `testDecimalDivisionDecisionAndSpeechLoop` **1项通过、0跳过、0失败，107.946秒**（整体xcodebuild观测111.545秒）。横屏窗口检查先通过；合成题照 `12.5÷0.5` 经真实识别、确认；用真实PencilKit拖画手势写出 `125÷5=205`。老师开场：`你算出的商里有个0，这个0需要保留吗？`。之后真实音频五轮：错商、解释两数同扩大、修正数位为25、自主乘法检验、迁移到4.8÷0.6。
5. 服务器实际决策焦点：`place_value → place_value → place_value → verify → return → return`；末轮 `handoff=true`。隔离记录修订15，5条提交、6条非空且未争议反馈，笔迹base64长度14500；照片和8份媒体条目保留。`/fixture/verdict/<sessionId>` 返回 `valid=true`。本轮作品ID：`a638b34c-2fd4-47a8-8345-a4eff5a2f9ae`。
6. 临时增加普通启动检查（不传隔离输入环境）：家长设置中找到真实Bonjour候选 `连接 AI-DTL 62a27a5d`，选择后地址为 `hb-mini.local`；退出重开仍保持该地址，未自动开麦。**1项通过、0失败，18.405秒**。原设置本来也是 `hb-mini.local`，不能将本轮说成从笔记本迁移家庭数据。
7. 测试后用 devicectl 正常启动应用，不带任何夹具环境/参数；真实家庭草稿路径没有删除或重写操作。8797临时宿主收尾停止，8791保持运行。

## 证据

笔记本稳定证据目录：
`/Users/houbin/Library/Application Support/ai-dtl/acceptance/2026-10-11-home-mini.hFTu6t/`

- `signed.xcresult`、`signed.log`：真实设备完整闭环结果。
- `normal-host.xcresult`、`normal-host.log`：普通启动主机选择和保留。
- `attachments/`：笔迹错商截图及最终讨论/保存截图。
- `normal-host-attachments/`：mini设置截图、之前地址文本。
- `mini-isolated-store/`：本轮合成样本的实际记录、教学决策、媒体及用量元数据。
- `mini-fixture.log`：mini隔离宿主实际模型阶段计时。
- `ChildLearningFlowUITests.swift`：实际执行的临时测试源码，含本轮直接mini地址和主机选择检查。产品仓库测试源码未改。
- `xcode.log`：第一次未指定开发团队的构建失败，保留；随后显式使用已有 `DEVELOPMENT_TEAM=YZQ2T35W5C` 签名构建并通过，不把第一次失败隐去。

## 仍未证明 / 下一步

- 本次是合成照片和孩子音频 + 真机界面/音频播放链路，不等于实物相机拍摄、真人语音听感、Apple Pencil二代笔尖触感或真实孩子学习效果验收。
- 先前模拟器834×1210方向问题未在本轮修复或复测；本次真机横屏通过不能反推模拟器已经正常。
- 实际老师仍可能在相邻轮次重复同一计算追问，本次第二/第三条都问了“百位上的1够不够除5”；链路通过不代表话术自然度已完成。
- Xcode结果包含音频会话主线程调用及QoS优先级倒置警告，本次未阻断测试，但应单独排查长对话卡顿，不能称零运行时风险。
- 本轮没有复跑全部动态儿童分支，也没有证明此前播报超时完全消失。此前两条失败样本14回合定向通过的证据仍见前一份交接，不冒充本轮在mini复跑。
- mini正式8791重载健康、普通App选中其身份；云端完整闭环在同源隔离8797完成，不能说本轮又向正式家庭库写了一整套测试记录。
- 当前只有既有私有GitHub远端，未配置GitLab；没有擅自创建远端或虚报推送。
