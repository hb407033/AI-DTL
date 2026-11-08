// UI 测试用的假实时服务。只回放固定头部、一句过门禁的话和一小段静音，不连接真实模型，也不读取密钥。
import { WebSocketServer } from "ws";

const port = Number(process.argv[2] ?? "8799");
const header = '{"transcript":"这题我不会，想先问问。","kind":"help"}';
const reply = process.env.AI_DTL_FAKE_REPLY ?? "你想先看哪一小份？";
const pcm = Buffer.alloc(480, 0);

const server = new WebSocketServer({ host: "127.0.0.1", port });
server.on("connection", socket => {
  socket.send(JSON.stringify({ type: "session.created" }));
  socket.on("message", raw => {
    let event: { type?: string; response?: { modalities?: string[] } };
    try { event = JSON.parse(raw.toString()); }
    catch { return; }
    if (event.type === "session.update") {
      socket.send(JSON.stringify({ type: "session.updated" }));
      return;
    }
    if (event.type !== "response.create") return;
    const audio = event.response?.modalities?.includes("audio") === true;
    const id = audio ? "reply-1" : "header-1";
    socket.send(JSON.stringify({ type: "response.created", response: { id } }));
    if (!audio) socket.send(JSON.stringify({ type: "response.text.delta", response_id: id, delta: header }));
    else {
      socket.send(JSON.stringify({ type: "response.text.delta", response_id: id, delta: reply }));
      socket.send(JSON.stringify({ type: "response.audio.delta", response_id: id, delta: pcm.toString("base64") }));
    }
    socket.send(JSON.stringify({ type: "response.done", response: { id, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }));
  });
});
server.on("listening", () => console.log(JSON.stringify({ ok: true, port })));
