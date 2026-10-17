import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

/** Identity belongs to this local store, not its changing USB/Wi-Fi address. */
export async function loadHostIdentity(directory: string): Promise<string> {
  await fs.mkdir(directory, { recursive: true });
  const file = join(directory, "host-id");
  try { await fs.writeFile(file, randomUUID(), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const id = (await fs.readFile(file, "utf8")).trim();
  if (!/^[0-9a-f-]{36}$/.test(id)) throw Error("invalidHostIdentity");
  return id;
}

export function discoveryArguments(hostId: string): string[] {
  return ["-R", `AI-DTL ${hostId.slice(0, 8)}`, "_ai-dtl._tcp", "local", "8791", "version=1", `hostId=${hostId}`];
}

export function advertiseHost(hostId: string): () => void {
  if (process.platform !== "darwin") return () => {};
  const child = spawn("/usr/bin/dns-sd", discoveryArguments(hostId), { stdio: "ignore" });
  child.on("error", () => console.warn("主机自动发现未启动，仍可手填地址连接。"));
  const stop = () => { child.kill(); };
  process.once("exit", stop);
  return () => { process.removeListener("exit", stop); stop(); };
}
