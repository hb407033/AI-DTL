// 门禁包里的网络占位。任何调用都失败，避免把密钥或套接字打进 JavaScriptCore。
function networkUnavailableInGates() {
  throw new Error("networkUnavailableInGates");
}
export const requestWorkspaceText = networkUnavailableInGates;
export const requestThinkingText = networkUnavailableInGates;
export const randomUUID = networkUnavailableInGates;
export const createHash = networkUnavailableInGates;
export default networkUnavailableInGates;
