# AI-DTL 第一阶段：Codex USB 真机独立验收

日期：2026-10-08。品牌：AI 学科心智学习系统。

实现者：原 Pi 会话 `pi_a6cc5b58-5af2-4fd5-a263-22b054c565ae`，模型 `modelarts/glm-5.2`。教学仍使用原 `qwen3.5-omni-flash-realtime`，未切换教学模型。Codex 独立验证，不将 Pi 的交付声明直接当作通过。

## 已实际验证

1. iPad 已信任原团队 `YZQ2T35W5C`，实际 USB 安装/启动成功。未卸载原 App、删除家庭学习记录或绕过信任门禁。
2. iPad 原生 URLSession 访问 mini `10.10.10.6:8791/healthz` 成功。主服务更新进程后 configured=true，原 hostId `62a27a5d-588d-4807-8ad9-db981fdc8d81` 不变；Hermes/飞书/9119 未操作。
3. 第三轮最新源码签名构建、真机覆盖安装成功；已确认题意时横竖屏首屏画布存在且可点、与窗口相交面积≥55%、对话按钮可点。UI 测试1通过、0失败。
4. 同构建原生相关测试17项：16通过、1跳过、0失败。覆盖回合检测、缓存冲突保留、pending保存、fixture、音频停播与麦克风启动停止。跳过项为尚未启用的声学测试，随后单独真实运行通过。
5. 声学测试单独通过：iPad 扬声器播放公开合成中文句子，真实内置麦克风捕获262298字节，峰值RMS约0.0401，输出音量0.65。未直接调用 onTurn 或注入 detector 冒充声学捕获。
6. 实际 iPad WorkspaceClient→mini隔离宿主→当前真实Omni→iPad音频播放，连续5轮通过：hello=1、audio事件108、5份证据与5条反馈落盘。测试输入是合成中文PCM；每轮由原生播放器实际播放完成触发 completedTurns，非mock供应商。不是真人连续开麦、儿童理解效果或无条件开放实时双工的验收。
7. 上述真实调用用量：10条记录、10个不同callId、5个turnId、全部completed，session/turn/call关联完整；5次ASR用量缺失记null，5次教学有实际usage；教学输入11745tokens、输出558tokens。费用未知记null，没有宣称免费。
8. 真机横竖屏分别在画布四区域留下笔迹，共8笔；退出重开仍8笔，开启对话按钮未变为自动录音，原照仍可打开。UI测试1通过、0失败。
9. 后端六组相关回归19项通过，发布指纹回归3项通过，tsc退出0。Shared、brand、契约fixture、工具纳入指纹，私有env排除。

## 快照与证据

- 稳定本机归档：`/Users/houbin/Library/Application Support/ai-dtl/acceptance/2026-10-08-stage1-7278d333`。安装包、日志、源码摘要与最后构建截图均保留在此，不只依赖临时目录。
- 完成最终复测后，devicectl 实际重新启动正常 bundle 成功，未携带测试 namespace/fixture 启动参数。
- 本次构建源来自mini，快照 `/tmp/ai-dtl-final-review.EJaVFw`。代码以mini为主；本机临时目录中的 Codex 开头测试是验收工具，不是产品功能变更。
- 第三轮 `LearningWorkspaceView.swift` SHA-256：`feaaa2ad00b19a7dd652e8a5eca486eafea7f8aafa8f250d8c404a1af27ecb38`；第四轮最终版为 `7278d333a6dcca643421be84ba6c6a0a80050dae1cc4af224f15640d30b8b0b9`。
- 最终App实际47个原生源码、Shared、品牌和契约fixture文件，逐文件SHA-256与mini一致，清单为 `native-source-sha256.txt`。
- 当前设备原团队开发签名安装包 `AI-DTL-stage1-development.ipa`，SHA-256 `cf7ffb18fed493be09e4d0544289d9d2f3c752390b274e7618060174e662a580`。不是App Store/任意设备安装包。
- `physical-final-tests.log`：相关原生 + 横竖屏首屏UI。
- `physical-acoustic-tests.log`：真实扬声器/麦克风回路。
- `physical-real-omni-loop.log`：同连接5轮真实Omni/原生播放/存档。
- `physical-canvas-persistence.log`：四区域触控、重开与原照。
- 横竖屏截图在 `attachments/`，其余xcresult保存在 `derived/Logs/Test/`。
- 隔离Omni存储位于mini `/var/folders/nk/cglr2s_d56j6bl_zpny9cyr00000gn/T/ai-dtl-real-omni-review-ntGnfu`，只含公开合成测试数据，未使用家庭工作区。
- 测试PCM服务8795与隔离宿主8796已停止；8791主学习宿主保留运行。

## 仍未通过／待验证

- A1 常驻：当前8791通过手动受控进程启动；LaunchAgent受mini Documents的TCC权限限制。尚不能宣称登录自动启动/进程自动恢复通过，不能把iPad信任授权当作mini文件访问授权。
- 第四轮恢复入口与长文本挤占画布回归修复已交付，task `task_2fd10858-c38b-4477-9253-c132d70a0a8a`。最终源码已覆盖安装，相关原生6项、首屏UI和四区域/重开UI共8项通过；另恢复栏真实横竖屏可触控、不自动开麦、继续独立与回看想法UI测试1项通过。日志 `physical-final-resume-tests.log`、`physical-resume-controls.log`。长文本行数/详情在源码复核，未冒充所有长回复/字体大小组合均实测。
- A4取消/纠正及A6离线冲突已有隔离路由和原生缓存测试，但尚未在本次同一最终构建上完成全部故障注入体验验收。
- 时延：5轮记录的8.4–11.4秒是整轮直到回复播放完成，不能当作最后有声采样→首段实际播放；未做20轮有效试验，不报告P95≤6秒达标。
- 自动触控与合成音频不冒充真人Pencil压感、儿童学习效果或真实家庭环境的全部体验验收。
- twin-status脚本仍报 `rel…: unbound variable`；分支 `codex/ipad-arrival-plan`、HEAD `e2a14d1`保持，大量既有脏文件保留。未整体暂存、commit、merge或push。

## 原失败未掩盖

第一轮签名曾选错W4团队，被原App identifier拒绝；改回原YZQ团队后正常更新。早期已确认页只改0.6h函数并不满足首屏验收，Codex拒绝。第三轮中途真实横屏面积52.49%失败并留下尺寸/截图；后续侧栏260pt和画布剩余空间布局的实际真机测试才通过。未降低55%阈值。
