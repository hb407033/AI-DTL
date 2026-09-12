# iPad Pro 到货验收清单

本单用于真实设备到货后验收，不代表已经通过。正式儿童端为 `apps/ipad/ScholarPad`；`ScholarPadProbe` 是阶段 0 测量工具，不是正式教学 App。

## 到货前可以完成

- 成长账本 206 条逐项映射，明确可自动化缺口；见 [验收矩阵](../superpowers/plans/2026-09-13-growth-ledger-acceptance-matrix.md)。
- Mac 临时 SQLite + 回环 HTTP 验证笔迹上传、幂等、宿主重启恢复、家长预览与删除，不动家庭正式库。
- iPad 模拟器执行 PKDrawing 序列化和缓存/恢复测试；这不能测真实 Pencil 延迟。
- Codex 固定文字/成人音频探针准备和身份准入检查。2026-09-13 当前身份仍被 `realtime conversation requires API key auth` 阻断，不擅自换鉴权。

## 设备安装准备

1. Mac 与 iPad 加入同一家庭 Wi-Fi，不配置公网映射。
2. 用 USB 首次连接并由家长在设备确认信任；在 Xcode 的设备列表确认可见。
3. 在 `apps/ipad/ScholarPad` 执行 `xcodegen generate`，打开生成的 `ScholarPad.xcodeproj`。
4. 在 Signing & Capabilities 选择家长自己的开发团队；Apple 账户及密码由家长直接操作，不能把凭据写进项目。若系统要求 Developer Mode，按设备提示开启并重启确认。
5. 选择真实 iPad 运行，允许家庭局域网访问。当前正式界面输入仍以文字为主，系统朗读不是 Codex 双向实时音频。

安装和开发者模式步骤参考 Apple 的[真机运行说明](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)与[Developer Mode 说明](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)。

## 隔离联调宿主

从仓库根目录启动临时库（关闭终端时 Ctrl-C 停止；保留临时目录便于复核，不自动清理）：

```sh
task_demo_dir=$(mktemp -d /tmp/scholar-ipad-demo.XXXXXX)
AI_SCHOLAR_DATA_DIR="$task_demo_dir" pnpm host
```

默认是家长桥接，不接模型。儿童端 HTTP/WS 为 `8788`；家长控制台只在 Mac 的 `http://127.0.0.1:8789/parent`。沿用已有家长认证，不通过消息传递 token。iPad 输入 Mac 的 `.local` 主机名；iPad 上的 localhost 指向 iPad 自身，不能填写 localhost。

## 真机笔迹闭环

1. 首次告知确认后，在同一会话画一幅有辨识度的图；确认家长作品预览显示相同原笔迹，不含 Agent 覆盖层。
2. 退出并重新打开 App，确认原笔迹位置、笔画保留，恢复不新增 STROKE/ERASE 证据。
3. 断网后追加笔画，再恢复网络，确认待传快照补传；宿主重启后再次打开仍一致。
4. 连续画多笔及上传中再画，确认恢复的是最后一版，不是较早一版。
5. 清空画布后重开，仍为空；清空是新版本，不等于抹去历史成长证据。
6. 孩子申请删除作品、家长确认后，原始笔迹/预览与关联内容失效；重新连接清空设备缓存，旧请求不能复活作品。离线设备须重新联机后才能获知删除。
7. 开启新会话，确认不会混入上一会话画布。

当前保存的是整幅 **会话画布**：首次上传后固定作品归属，独立保存版本。各教学 run 的语义事件/host snapshot 另行保留；不宣称每个 run 都已有独立原始笔迹快照。由于不能从整幅画中可靠切除某轮内容，删除本会话任一作品时，共享原画布也纳入删除预览与事务，不保留可能包含已删内容的预览。

## 音频与体验门禁

先解除并实测 Codex 准入，再接真实 iPad 音频链路。没有准入时只验本地录放音/打断，整体音频项维持 BLOCKED。

已准备 Mac 侧诊断命令，仅使用事先确认的成人/合成固定 WAV（24kHz、单声道、PCM16、最多 30 秒）：

```sh
pnpm gate:codex --trials 1 --audio-file /absolute/path/adult-fixture.wav --confirm-adult-audio
```

该路径不会生成录音，也不会检索用户音频文件；没有明确文件时拒绝。报告为首个输入块到首输出音频，不是用户说完到播放，也不是 iPad 全链路指标。鉴权拒绝立即停，不重复消耗 20 次尝试。

真实验收使用总体设计 §11.3.1：Pencil 显示 P95≤50ms、本地打断 P95≤200ms、事件确认 P95≤150ms、说完到播放 P50≤1.5s/P95≤3s、语义动作显示 P95≤300ms。按阶段 0 探针记录样本，不能凭“感觉挺快”通过。
