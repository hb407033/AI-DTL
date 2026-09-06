// Codex app-server 的 stdio JSON-RPC 客户端：一行一条 JSON；请求按 id 配对，通知按方法名分发。
// 不用 shell 启动子进程；握手必须声明 experimentalApi，收到 initialize 响应后才发 initialized。
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

export interface SpawnOptions {
  command?: string;
  args?: string[];
  experimentalApi: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface ClientInfo {
  name: string;
  title: string;
  version: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface NotificationWaiter {
  method: string;
  resolve: (params: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export type NotificationListener = (method: string, params: unknown) => void;

export class AppServerClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly waiters: NotificationWaiter[] = [];
  private readonly listeners = new Set<NotificationListener>();
  private readonly stderrTail: string[] = [];
  private exitCode: number | null | undefined;
  private readonly exited: Promise<number | null>;

  static async spawn(options: SpawnOptions): Promise<AppServerClient> {
    const child = spawn(options.command ?? "codex", options.args ?? ["app-server", "--enable", "realtime_conversation", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      env: options.env ?? process.env,
    });
    return new AppServerClient(child, options.experimentalApi);
  }

  private constructor(private readonly child: ChildProcess, private readonly experimentalApi: boolean) {
    createInterface({ input: child.stdout! }).on("line", (line) => this.onLine(line));
    createInterface({ input: child.stderr! }).on("line", (line) => {
      this.stderrTail.push(line);
      if (this.stderrTail.length > 50) this.stderrTail.shift();
    });
    this.exited = new Promise((resolve) => {
      child.on("exit", (code) => {
        this.exitCode = code;
        const error = new Error(`app-server 已退出（code=${code}）`);
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
        this.pending.clear();
        for (const w of this.waiters.splice(0)) { clearTimeout(w.timer); w.reject(error); }
        resolve(code);
      });
    });
  }

  /** 最近的 stderr 行，用于失败时诊断 */
  get recentStderr(): string[] { return [...this.stderrTail]; }

  async initialize(clientInfo: ClientInfo): Promise<{ userAgent?: string }> {
    const result = await this.request<{ userAgent?: string }>("initialize", {
      clientInfo,
      capabilities: { experimentalApi: this.experimentalApi },
    });
    this.notify("initialized", {});
    return result;
  }

  request<T>(method: string, params: unknown, options: { timeoutMs?: number } = {}): Promise<T> {
    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? 10_000;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  waitForNotification<T>(method: string, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waiter: NotificationWaiter = {
        method,
        resolve: resolve as (p: unknown) => void,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error(`等待通知 ${method} 超时（${timeoutMs}ms）`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  onNotification(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 关闭 stdin 让子进程自然退出；3 秒不退则 SIGTERM。返回退出码。 */
  async close(): Promise<number | null> {
    if (this.exitCode !== undefined) return this.exitCode;
    this.child.stdin?.end();
    const killer = setTimeout(() => this.child.kill("SIGTERM"), 3_000);
    const code = await this.exited;
    clearTimeout(killer);
    return code;
  }

  private write(message: unknown): void {
    this.child.stdin?.write(JSON.stringify(message) + "\n");
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let message: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string } };
    try {
      message = JSON.parse(line);
    } catch {
      return;   // app-server 偶尔在 stdout 混入非 JSON 行，忽略
    }
    if (typeof message.id === "number" && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${message.error.message ?? "JSON-RPC error"}（code ${message.error.code ?? "?"}）`));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      // 服务端发来的带 id 的请求（如审批）在阶段 0 不处理：直接以错误拒绝，避免对端挂起
      if (typeof message.id === "number") {
        this.write({ id: message.id, error: { code: -32601, message: "probe does not handle server requests" } });
        return;
      }
      for (const listener of this.listeners) listener(message.method, message.params);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const waiter = this.waiters[i]!;
        if (waiter.method !== message.method) continue;
        this.waiters.splice(i, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message.params);
      }
    }
  }
}
