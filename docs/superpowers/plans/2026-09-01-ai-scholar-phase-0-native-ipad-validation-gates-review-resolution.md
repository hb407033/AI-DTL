# 阶段 0 工程设计评审处置记录

**日期：** 2026-09-01  
**结论：** **阶段 0 工程计划允许进入实现；安全与模型侧数据保留明确暂缓，不再作为本阶段门禁。**

## 1. 用户裁决

1. 长期档案与结果文件保存在 Mac mini 本地；儿童数据安全和模型侧数据保留暂不纳入阶段 0。
2. iPad 与 Mac mini 只在家庭局域网使用，阶段 0 采用 `http://` 与 `ws://`，不实现 TLS、证书固定、配对和会话令牌。
3. pnpm 子包缺少清单属于工程计划错误，由计划直接补齐，不向用户追加决策问题。
4. Codex realtime 使用进程 feature flag 与 JSON-RPC experimental capability 两级开启。

## 2. 已完成修订

### 2.1 家庭网络

- 总设计已改为家庭局域网 `HTTP + ws://`，并明确不开放公网：`docs/superpowers/specs/2026-08-30-ai-scholar-learning-system-design.md:679-686`。
- 阶段 0 计划固定网关 `0.0.0.0:8787`、`GET /healthz`、WebSocket `/probe`，iPad 使用 Mac mini `.local` 主机名：`docs/superpowers/plans/2026-09-01-ai-scholar-phase-0-native-ipad-validation-gates.md:606-666`。
- iPad 工程只增加 `NSAllowsLocalNetworking`，不设置全局 `NSAllowsArbitraryLoads`：`docs/superpowers/plans/2026-09-01-ai-scholar-phase-0-native-ipad-validation-gates.md:210-230,284`。

### 2.2 pnpm 工作区

- 文件树现已包含四个子包的 `package.json`、`tsconfig.json` 和缺失的入口/测试文件：`docs/superpowers/plans/2026-09-01-ai-scholar-phase-0-native-ipad-validation-gates.md:33-100`。
- 每个子任务先创建完整包清单，再用 `pnpm --filter <name> exec pwd` 验证匹配，最后安装依赖：
  - `gate-contracts`：`293-351`；
  - `gate-server`：`606-645`；
  - `codex-realtime-probe`：`729-768`；
  - `gate-report`：`869-935`。

### 2.3 Codex realtime 双重开启

进程启动：

```bash
codex app-server --enable realtime_conversation --stdio
```

客户端初始化：

```json
{
  "method": "initialize",
  "id": 1,
  "params": {
    "clientInfo": {
      "name": "ai_scholar_probe",
      "title": "AI Scholar Probe",
      "version": "0.1.0"
    },
    "capabilities": {
      "experimentalApi": true
    }
  }
}
```

收到成功响应后再发送：

```json
{"method":"initialized","params":{}}
```

两级开关、版本固定和失败测试已经写入 Task 7：`docs/superpowers/plans/2026-09-01-ai-scholar-phase-0-native-ipad-validation-gates.md:771-829`。

本机 Codex CLI `0.144.1` 已实测：以上握手成功返回 `userAgent`，随后 `thread/realtime/listVoices` 成功返回 v1/v2 voice 列表。这证明**实验能力已能开启并调用列表接口**；尚未证明输入音频、延迟、计费归属和长会话稳定性，这些继续由 Task 7–10 验证。

阶段 0 推荐使用上面的进程级临时开关，不修改用户全局配置。若以后确定要永久开启，可执行 `codex features enable realtime_conversation`；但每个客户端连接仍然必须在 `initialize` 中发送 `experimentalApi: true`。

补充核验发现：本机 `generate-json-schema` 没有导出实验 realtime 的客户端请求类型，不能把“生成了 schema”误当成协议完整。计划已增加与 `codex-cli 0.144.1` / `rust-v0.144.1` 严格绑定的最小契约文件和版本漂移门禁。

### 2.4 `800ms` 静音

计划不再把 800ms 当作固定协议，而是按 800/1200/1600ms 各 5 次逐级验证；三个值都失败则标记 `BLOCKED`：`docs/superpowers/plans/2026-09-01-ai-scholar-phase-0-native-ipad-validation-gates.md:852-858`。

## 3. 暂缓项

以下内容不是被证明“不需要”，而是按用户决定暂不实现：

- TLS 与证书固定；
- 配对、session token 和局域网客户端鉴权；
- 儿童数据与模型侧数据保留门禁；
- 非家庭可信局域网和公网部署。

若部署边界变化，再单独做安全设计，不在当前工程里预埋复杂实现。
