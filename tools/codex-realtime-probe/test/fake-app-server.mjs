// 测试用的假 app-server：按行读 JSON-RPC，模拟握手、实验能力门槛、realtime 启动通知与"永不回复"的方法。
// 不访问网络、不读真实 Codex 配置。
import { createInterface } from "node:readline";

const received = [];
const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  received.push(msg.method);
  switch (msg.method) {
    case "initialize": {
      if (!msg.params?.capabilities?.experimentalApi) {
        send({ id: msg.id, error: { code: -32600, message: "initialize requires experimentalApi capability" } });
        return;
      }
      send({ id: msg.id, result: { userAgent: "fake-app-server/0.0.0" } });
      return;
    }
    case "initialized":
      return;                                  // 通知，无回复
    case "debug/received":
      send({ id: msg.id, result: { received: [...received] } });
      return;
    case "thread/realtime/start":
      send({ id: msg.id, result: {} });
      send({ method: "thread/realtime/started", params: { threadId: msg.params.threadId, version: "v2" } });
      return;
    case "slow/never":
      return;                                  // 故意不回复，用来测超时
    default:
      send({ id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } });
  }
});

rl.on("close", () => process.exit(0));
