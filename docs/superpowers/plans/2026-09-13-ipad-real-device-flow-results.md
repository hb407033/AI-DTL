# iPad 真机学习流程实测

2026-09-13；设备：iPad Pro 11-inch 第四代，iPadOS 27.0；分支 codex/ipad-arrival-plan。

## 结论

完整脚本教学闭环已在真机通过，但不能宣称自主 AI 教学闭环通过。日常测试桥接恢复为 parent，不是 Codex；求助需要家长控制台提供提案。下方早期记录保留，最新结果以本节为准。

## 本轮推进结果（21:00 更新）

- 修复发送后键盘不收起；求助等待期间显示“正在等待提示…”；结束页在浅色画布上使用黑色文字。等待提示仅为界面反馈，不冒充模型回复或写入学习证据。
- 真机交互与品牌回归：4 项通过，结果包 `/tmp/ai-dtl-interaction-final-20260913.xcresult`，包括深色模式下白纸黑笔。
- 真机完整脚本闭环：2 项通过，结果包 `/tmp/ai-dtl-loops-final-20260913.xcresult`。覆盖求助、一级提示、独立表达、讲回、迁移成功结束，以及迁移失败后主动结束。成功路径对成长记录选择“还不确定”，没有借测试认可长期结论。
- 原生扩大回归：35 项通过、5 项失败，结果包 `/tmp/ai-dtl-native-regression-final-20260913.xcresult`；其中真机“你理解错了”异议反馈通过。5 项失败均为旧测试读取 Mac 的 `#filePath` 仓库路径，在 iPad 上不存在：MemoryPreviewTests 的源码检查，以及 SessionProtocolTests 的 4 项 JSON 夹具读取。需将测试资源打包或把源码检查移到 Mac；未跳过或弱化断言，不宣称全量通过。
- 宿主和学习内核：46 个测试文件、391 项通过；Codex 探针：3 个文件、16 项通过。宿主及探针 TypeScript 类型检查通过，`git diff --check` 通过。
- 真机测试改用已安装的 Xcode 27（`/Users/houbin/Downloads/Xcode.app`），通过每条命令设置 `DEVELOPER_DIR`；没有改全局 Xcode 选择。旧 Xcode 26.6 下中断或超时的轮次不计为通过。
- 当前 Codex CLI 0.154.0 的本地实验协议已核查并更新锁定契约。真实 ChatGPT 身份探针仍返回 `realtime conversation requires API key auth`，结论 BLOCKED。详见 [鉴权门禁复核](2026-09-13-codex-0154-gate-review.md)。没有寻找密钥、切换身份或替换模型。
- 脚本测试采用独立目录 `/var/folders/h0/9hs2mkcj5tsd_v8nvjb9jy5r0000gn/T/ai-dtl-scripted-test-moYbLe`，家长模式采用原隔离目录。全程使用成人合成输入，不读取或修改正式儿童档案，不删除旧画作。

### 尚未关闭

1. 真实 Codex 实时语音与多模态接入鉴权门禁；脚本状态转换不证明真实模型理解或教学效果。
2. 上述 5 项原生测试资源的真机可移植性。
3. App 重启后客户端事件序号恢复风险；本轮使用新会话，不宣称重启重放已通过。
4. 首次说明滚动确认体验，以及等待家长提案期间暂停是否能及时生效，仍需单独验证。
5. 文学插件、跨周成长效果与真实孩子的教学有效性不在本轮通过范围。

## 实测证据

- 用户确认 Apple Pencil 二代书写正常。此前黑纸黑笔问题已改为固定浅色书写区；服务端原笔迹保留。
- 竖屏黑边修复后直接设备截图验收；横屏旋转未实测。
- XCTest 真机用例 testDeviceLocalSessionControls 通过：真实网络取得题目、暂停、继续、输入 0.72、求助。SQLite 中依次出现 PAUSE_REQUEST、RESUME_REQUEST、UTTERANCE、HELP_REQUEST，序号 1–4。
- XCTest 真机用例 testDeviceDoneRequestsExplainBack 通过：新会话点“我做完了”，任务变为讲回提示。没有把空白点完成解释为掌握。
- 结果包：/tmp/ai-dtl-local-flow-retry-20260913.xcresult、/tmp/ai-dtl-explain-flow-20260913.xcresult。第一轮截图导出到 /tmp/ai-dtl-flow-attachments。
- 测试使用隔离目录 /var/folders/h0/9hs2mkcj5tsd_v8nvjb9jy5r0000gn/T/ai-dtl-device-test-oBHmew，不读取正式档案或家长密钥。自动化使用新会话，原画作未删除。

## 阻断和体验问题

1. 求助按钮事件到达，但 parent 桥接等待人工提案，截图中仍为旧话“我在这里，你先试试看”。没有新的自动提示；不能把按钮点击通过称为教学通过。
2. 输入并发送后键盘仍占据下半屏，缩小画布；下一步应补焦点与键盘收起验收。
3. 首次说明在固定高度滚动区，确认按钮不在初始可见区域；儿童首次使用体验需单独改善，不代替真实孩子确认。
4. 尚未验证真实 Codex 语音、实时看懂笔迹、讲回判定质量、迁移题到结束、跨会话长期记录。当前数学解释规则包含关键词匹配，功能通过不等于教学有效。
5. 重启续接存在既知客户端事件序号恢复风险，本轮以新会话隔离，未宣称该风险已修复。

## 工具限制

首次 UI 自动化等待设备密码超时；用户授权后重跑通过。Simulator 启动仍有异常，不能把此前仅编译的深色画布回归测试报告成已执行通过。设备截图、安装、真实 UI 自动化现均已可用，无需用户反复传截图。
