type Env = Record<string, string | undefined>;
export interface PiConfig { command: string; provider: string; model: string }
export interface QwenConfig { url: string; apiKey: string }

const required = (env: Env, name: string): string => {
  const value = env[name]?.trim();
  if (!value || /[\r\n]/.test(value)) throw new Error(`配置缺失或无效：${name}`);
  return value;
};
export function loadPiConfig(env: Env = process.env): PiConfig {
  return { command: env.AI_DTL_PI_COMMAND?.trim() || "pi", provider: required(env, "AI_DTL_PI_PROVIDER"), model: required(env, "AI_DTL_PI_MODEL") };
}
export function loadQwenConfig(env: Env = process.env): QwenConfig {
  const apiKey = required(env, "DASHSCOPE_API_KEY");
  const workspace = required(env, "AI_DTL_QWEN_WORKSPACE_ID");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(workspace)) throw new Error("配置无效：AI_DTL_QWEN_WORKSPACE_ID");
  return { apiKey, url: `wss://${workspace}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime` };
}
/** 仅供本机命令行。即使失败也不序列化原配置或敏感值。 */
export function inspectAiConfig(env: Env = process.env) {
  function inspect(names: string[], validate: () => unknown) {
    const missing = names.filter(name => !env[name]?.trim());
    let valid = false;
    try { validate(); valid = true; } catch { /* 只显示结构状态 */ }
    return { ready: valid, missing, status: valid ? "configured-not-authenticated" : "not-ready" };
  }
  return { qwen: inspect(["DASHSCOPE_API_KEY", "AI_DTL_QWEN_WORKSPACE_ID"], () => loadQwenConfig(env)),
    pi: inspect(["AI_DTL_PI_PROVIDER", "AI_DTL_PI_MODEL"], () => loadPiConfig(env)) };
}
