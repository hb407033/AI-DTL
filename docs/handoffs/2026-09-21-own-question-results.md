# 观察对象、自主提问与证据链验证

日期：2026-09-21。分支：codex/ipad-arrival-plan。未提交或推送，保留工作区已有改动。

## 已核验

- 原先持续运行的 iPad `testSyntheticPhotoRealRecognitionDrawingSaveAndRelaunch` 已通过：1 项、1496.275 秒、零失败。不是仍在等待；系统动画通知延迟解释了耗时。截图可见保存成功、引用第 7 版实际笔迹。
- 新入口允许拍观察对象后直接写自己的问题，不要求照片里先有一道题。不调用识别器；先确认再进入探索，麦克风不自动开启。
- 问题草稿与重试请求落本地缓存；主机按稳定事件 ID 幂等保存，检查版本、原照片引用、人教版五年级上。重试首个创建会话响应丢失仍可能留下空会话，不宣称全流程严格 exactly-once。
- 模拟器 `testPhotoObjectOwnQuestionWithoutRecognition` 通过。测试用无任何模型/识别器的 IPv6 loopback 宿主，临时目录独立于家庭数据。修复 DEBUG 测试宿主显式注入，测试先断言宿主地址，避免持久化默认值把流量导向家庭主机。
- 隔离落盘记录 `ed8dd7df-7b0c-482b-b3ad-5aaf27568f22`：原照片引用存在，孩子问题原文保留，confirmed=true、phase=exploring、feedback=[]。
- 教学快照分开标注原始照片与孩子笔迹；仅保存问题不会发送图片给模型。明确请求老师反馈时才沿用已有授权链路传图。
- 快照 3 项测试通过（含新增观察对象、深色墨迹、180KB 编码预算）；相关主机 10 项测试通过，主机类型检查通过，设备构建成功。
- 家用主机已重启加载最新端点和教学上下文，`http://127.0.0.1:8791/healthz` 返回 ok/configured=true。该检查不等于模型教学验证。
- 最新原生 App 已通过 devicectl 安装到连接的 iPad 并启动成功，bundleID 为 com.houbin.aischolar.pad。安装启动不代替真机交互验收。

## 证据

目录：`docs/handoffs/evidence/2026-09-21-own-question/`。

- `ipad-linked-evidence.png`：已核验的真实 iPad 证据引用截图。
- `own-question-simulator.png`：观察照片、原问题及探索画布；测试输入为英文以避免输入法干扰。
- `synthetic-workspace.json`：仅上述合成测试记录，不含家庭作品。
- `ai-dtl-evidence-device-verified.log`、`ai-dtl-own-question-ui-verified.log`：最终通过日志。
- `ai-dtl-source-photo-red-runtime.log`、`ai-dtl-source-photo-green.log`：照片缺失的失败断言及修复通过。
- `ai-dtl-own-question-final-backend.log`：10 项主机回归。

## 未覆盖与后续

最新自主提问与照片教学快照尚未做完整真机专项回归；前述真机通过的是上一构建的证据链，不可混称。照片与真实千问语音联合推理尚待验证，单测不证明模型能正确理解观察对象。

继续检验→修改解释→新情境迁移→回望作品的完整自动验证，不强迫孩子填满八种记录，不将记录数当学习效果。家庭主机既有合成作品仍需显式测试标记/隔离，不凭标题删除。
