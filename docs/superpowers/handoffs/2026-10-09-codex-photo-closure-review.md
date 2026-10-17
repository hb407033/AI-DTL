# Codex 新照片闭环验收及待修复问题

## 已验证

在已连接的珩pad 上执行 `CodexNewPhotoLearningLoopTests`，新建隔离本机草稿，使用公开合成题图，经过实际 HTTP 创建/上传/千问识别/确认，再通过真实 WebSocket 进行两轮语音、实际原生播放，暂停后重开缓存并重新读取主机记录。

通过运行：`/tmp/ai-dtl-new-photo-semantic.xcresult`、`ai-dtl-new-photo-semantic.log`，xcodebuild 退出 0，TEST SUCCEEDED。

同一 session：`c9b621ec-44c9-4252-9ea7-cb67b59212b3`。确认前候选未确认；后续同一 photoId，原始照片字节一致，原始笔迹落盘字节一致，重新解码后的笔画、路径坐标、尺寸、力与透明度一致。两条提交证据、两条反馈保留，单次 hello，收到实际音频。暂停后未连接、未监听麦克风。

隔离后端为 mini 的 8798 端口，数据目录 `/tmp/ai-dtl-codex-new-photo-store-vXGpYf`。`closure-test.local` 是验收专用 URLProtocol 路由适配器，只转发这个测试主机名的 HTTP 到隔离后端，不截获家庭请求；WebSocket 直接连接隔离 mini。测试生成的 PCM 经原生客户端发送，不代表真人麦克风/Pencil 主观体验。此测试没有模拟器替代真机，也没有从已确认题目夹具起步。

测试恢复前后的 workspaceHost/workspaceCurrentUnit 由 defer 恢复，草稿使用 UUID 临时目录。8791 家庭主机未停止或变更。测试 scheme/路由适配器仅在笔记本独立源码快照中，不能混入最终安装包或替代正式回归。

## 失败记录与判定

- 第一次普通 scheme 编译失败，既包括 Codex 验收工具与 URLProtocol.task 重名（已修复），也包括产品 `WorkspaceError.server` 变成两个关联参数但旧调用仍只传 HTTP 状态（尚需修复）。
- 第一次独立真机测试两轮完成后，比较重新解码 PKDrawing 的再次编码字节失败（316 对 294 字节）。不能凭此判笔迹丢失：主机原稿字节仍一致。第二次改为同时核对**缓存原稿字节**及**重新解码后的逐笔/逐点语义**，均通过；保留失败日志，没有弱化原稿保存要求。
- 不能因隔离 scheme 通过就报告普通测试 suite 通过，它避开了尚未修复的旧测试编译阻断。

## Pi 交付必须先修复/核实

1. `apps/ipad/ScholarPad/ScholarPad/Session/WorkspaceModels.swift:78` 的 `server(Int, String?)` 破坏现有 `.server(409)`、`.server(500)` 调用。恢复兼容构造或全面核实直接调用方；不要删除旧测试来隐藏问题。错误 reason 只允许白名单中文映射。
2. `ProblemCaptureModel.swift` 仍声明 Upload 和保存 injected upload，但新的 `usePhoto()` 不再调用它，旧依赖注入测试会失效。这既是兼容性问题，也使已有测试无法验证真实分支。恢复该已存在的注入契约，或明确替换为能测试每阶段真实行为的 HTTP 注入并更新直接关联测试，不能仅移除断言。
3. 新 `PendingPhotoRecognition` 未绑定主机地址，识别失败后换主机可能把旧主机 session/photoId 发往新主机。必须绑定并在重试前检验；提示回原主机或明确从保留照片开始新的提交，不能混用两台主机的 ID。
4. 候选接收前不仅要 `validated()`，还应验证返回 sessionId、source= camera、photoId、课程和未确认状态属于当前 pending 请求，再清除 pending。
5. 继续完成配置引导与重试 UI 的自动验收，从实际新照片/待提交状态开始；不能用 confirmed fixtures 相加替代。

这是一份执行中的评审，不是最终验收。Pi 的当前任务等待仍保持原来的单个 pi_wait 请求，未关闭 GLM5.2 会话；业务代码归 Pi 修改，Codex 不并发覆盖其文件。
