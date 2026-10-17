// 分数学习练习模式宿主（2026-09-17 批准设计，工作包 C/E）：与 simple-tutor 自由连续聊天完全隔离。
// 只有合法 FractionEnvelope 的 submit/requestHelp 才向 Omni 发起教学响应；绘图、停顿、静音、画完一笔绝不触发 response.create。
// AI 图形动作一律经 tutor-learning-actions 校验：通过才下发孩子端并回传 applied:true，失败如实回传 applied:false。
// 存档接线（工作包 E）：注入 LearningSessionStore 后，每条被接受的信封落一条事实记录；AI 反馈呈现与异议同样落盘；
// 孩子端 hello 带 sessionId 可恢复存档会话；墓碑/缺失记录一律按新会话处理，绝不复活旧数据；保存失败如实报 error。
// 语音提交未实现自动等价：仅把明确短语的可验证转写作为 voiceIntent 转发给孩子端确认，绝不替孩子生成提交。
import Fastify from "fastify";
import { teacherSpeechStyle } from "./teacher-speech-style.js";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  fractionBoardSchema,
  fractionEnvelopeSchema,
  type FractionBoard,
  type FractionPhase,
} from "@ai-scholar/session-contracts";
import { FractionSession } from "../learning/fraction-session.js";
import { fractionPack, getChallenge } from "../learning/fraction-pack.js";
import { LearningSessionStore, type LearningSessionRecord } from "../learning/learning-session-store.js";
import { TutorLearningActions } from "./tutor-learning-actions.js";
import { loadQwenConfig, type QwenConfig } from "./config.js";
import { registerWorkspaceRoutes } from "./workspace-route.js";
import { WorkspaceStore } from "../learning/workspace-store.js";
import { recognizePhoto } from "./qwen-workspace-session.js";
import { WorkspaceVoiceProvider } from "./workspace-voice-provider.js";
import { QwenTeachingDecisionProvider } from "./workspace-teaching-decision.js";
import { registerWorkspaceVoice } from "./workspace-voice-route.js";
import { WorkspaceScaffoldService, registerWorkspaceScaffold } from "./workspace-scaffold-route.js";
import { QwenLineScaffoldProvider } from "./qwen-line-scaffold.js";
import { advertiseHost, loadHostIdentity } from "./host-discovery.js";
import { appendUsageJsonl } from "./workspace-usage.js";

// 白名单图形工具：与探针验证过的 show_fraction_hint 同族；description 即模型的唯一约束来源。
const TUTOR_TOOLS = [
  {
    type: "function",
    name: "show_hint_rectangle",
    description: "在孩子白板的提示层展示一个只读分数矩形。rows/columns 为正整数且乘积不超过 60，shadedCells 为从 0 开始按行优先的唯一格子索引。",
    parameters: {
      type: "object",
      properties: {
        wholeGroupId: { type: "string" },
        rows: { type: "integer", minimum: 1 },
        columns: { type: "integer", minimum: 1 },
        shadedCells: { type: "array", items: { type: "integer", minimum: 0 } },
      },
      required: ["wholeGroupId", "rows", "columns", "shadedCells"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "highlight_cells",
    description: "高亮提示层已有矩形的指定格子。objectId 必须引用已经展示的提示矩形。",
    parameters: {
      type: "object",
      properties: {
        objectId: { type: "string" },
        cells: { type: "array", items: { type: "integer", minimum: 0 } },
      },
      required: ["objectId", "cells"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "hide_hint",
    description: "隐藏提示层已展示的矩形。objectId 必须引用已经展示的提示矩形。",
    parameters: {
      type: "object",
      properties: { objectId: { type: "string" } },
      required: ["objectId"],
      additionalProperties: false,
    },
  },
];

const TOOL_TO_ACTION: Record<string, "showHintRectangle" | "highlightCells" | "hideHint"> = {
  show_hint_rectangle: "showHintRectangle",
  highlight_cells: "highlightCells",
  hide_hint: "hideHint",
};

// 明确短语白名单：只有可验证转写整体落在短语集合内才转发意图；模糊语音只询问，绝不自动提交。
const VOICE_SUBMIT_PHRASES = ["我做好了", "我做完了", "看看我的想法", "检查一下"];
const VOICE_HELP_PHRASES = ["帮我一下", "帮帮我", "我需要提示"];

function matchVoiceIntent(transcript: string): "submit" | "help" | null {
  const normalized = transcript.replace(/[\s。，！？!?,．、~～]/g, "");
  if (!normalized) return null;
  if (VOICE_SUBMIT_PHRASES.some((p) => normalized === p)) return "submit";
  if (VOICE_HELP_PHRASES.some((p) => normalized === p)) return "help";
  return null;
}

const INSTRUCTIONS = [
  "你是 AI 学科心智学习系统的分数老师，陪伴小学五年级孩子，家长在旁。",
  "孩子只有主动提交或求助时你才会收到消息；其余时间保持安静。",
  "先用一句话复述你理解到的孩子想法，再决定下一步；每次最多一个追问或一小步提示，不要直接完整解题。",
  "需要图形提示时调用工具；只有工具结果 applied 为 true 才说明图形真的展示了，绝不要口头声称已经画好。",
  "看不清笔迹或证据含糊时明确询问，不猜测对错；不诊断能力、不贴标签、不提成长档案。",
].join("");

export interface LearningTutorOptions {
  hostId?: string;
  store?: LearningSessionStore;
  workspaceStore?: WorkspaceStore;
}

export async function buildLearningTutor(config: QwenConfig | null, options: LearningTutorOptions = {}) {
  const store = options.store;
  const app = Fastify();
  await app.register(websocket, { options: { maxPayload: 3 * 1024 * 1024 } });
  app.get("/healthz", async (_req, reply) => { reply.header("cache-control", "no-store"); return { status: "ok", mode: "learning-tutor", configured: !!config,
    ...(options.hostId ? { hostId: options.hostId, discoveryVersion: 1 } : {}) }; });

  // 删除本次学习记录：墓碑由 store 保证迟到保存不得复活
  app.delete<{ Params: { sessionId: string } }>("/learning/:sessionId", async (req, reply) => {
    if (!store) return reply.code(503).send({ ok: false, reason: "storeDisabled" });
    const sessionId = req.params.sessionId;
    try {
      await store.delete(sessionId);
      return { ok: true, sessionId };
    } catch {
      return reply.code(400).send({ ok: false, reason: "invalidSessionId" });
    }
  });

  const active = new Set<() => void>();
  const workspaceStore = options.workspaceStore ?? new WorkspaceStore();
  const unavailable = async (): Promise<never> => { throw Error("scaffoldUnavailable"); };
  const scaffolds = new WorkspaceScaffoldService(workspaceStore, config
    ? new QwenLineScaffoldProvider(config) : { understand: unavailable, generate: unavailable });
  registerWorkspaceScaffold(app, workspaceStore, scaffolds);
  const usageJsonlPath = path.join(workspaceStore.directory, "usage.jsonl");
  registerWorkspaceVoice(app, workspaceStore, () => {
    if (!config || active.size) throw Error("voiceUnavailable");
    // 从 URL query 提取非敏感模型字段；不含密钥，缺失记 unknown。
    const modelFromUrl = (() => { try { return new URL(config.url).searchParams.get("model") ?? "unknown"; } catch { return "unknown"; } })();
    const provider = new WorkspaceVoiceProvider(config, { onUsage: r => {
      // 只写元数据：模型/用途/状态/用量/标识；不含 PCM/照片/密钥/完整转写。失败不中断孩子交流。
      // 身份来自路由传入的 context（sessionId/turnId）与每次调用的 callId，不再为空串。
      void appendUsageJsonl(usageJsonlPath, {
        sessionId: r.sessionId ?? "unknown", turnId: r.turnId ?? "unknown", callId: r.callId,
        purpose: r.purpose, model: modelFromUrl, status: r.status,
        ...(r.responseId ? { responseId: r.responseId } : {}),
        usage: r.usage, estimatedCostCny: null }).catch(() => {});
    } });
    const close = () => { provider.close(); active.delete(close); };
    active.add(close);
    return { transcribe: (pcm, signal, ctx) => provider.transcribe(pcm, signal, ctx),
      respond: (pcm, instructions, image, audio, signal, ctx) => provider.respond(pcm, instructions, image, audio, signal, ctx), close };
  }, (record, submissionId, responseId, signal) => scaffolds.offerAfterHelp(record.sessionId, submissionId, responseId, signal),
    config ? new QwenTeachingDecisionProvider(config, record => { void appendUsageJsonl(usageJsonlPath, record).catch(() => {}); })
      : { decide: async () => { throw Error("voiceUnavailable"); } },
    config?.decisionMode === "thinking");
  registerWorkspaceRoutes(app, workspaceStore, {
    recognize: async image => {
      if (!config || active.size) throw Error("recognitionUnavailable");
      const controller = new AbortController();
      const stop = () => controller.abort();
      active.add(stop);
      try { return await recognizePhoto(config, image, controller.signal); }
      finally { active.delete(stop); }
    },
  });
  app.addHook("preClose", async () => { for (const close of active) close(); });

  app.get("/tutor/learning", { websocket: true }, (child) => {
    if (!config || active.size >= 1) {
      child.send(JSON.stringify({ type: "error", message: config ? "已有一个学习会话，请先停止。" : "请先在 Mac 配置千问 Key 和工作空间。" }));
      child.close();
      return;
    }
    const cloud = new WebSocket(config.url, { headers: { Authorization: `Bearer ${config.apiKey}` }, maxPayload: 512 * 1024, handshakeTimeout: 10_000 });
    // session 在 hello（恢复请求）或上游就绪时建立；此前只缓存，不接受任何信封
    let session: FractionSession | null = null;
    let actions: TutorLearningActions | null = null;
    let restored = false;
    let helloPromise: Promise<void> | null = null;
    let state: "connecting" | "ready" | "committing" | "responding" | "closed" = "connecting";
    let answerAfterCommit = false;
    let configured = false;
    let audioBytes = 0;
    let activeSubmissionId: string | null = null;
    let currentResponseId: string | null = null;
    let localResponseSeq = 0;
    const cancelledResponses = new Set<string>();
    let dropUntilDone = false; // 取消后没有 response_id 的迟到增量一律丢弃到 done 为止
    const pendingCalls: { callId: string; name: string; args: string }[] = [];
    const transcriptByResponse = new Map<string, string>();
    // 存档状态：最近已知的孩子笔迹/画布（随提交与 AI 动作更新）
    let lastChildInk = "";
    let lastBoard: FractionBoard = { revision: 0, rectangles: [] };
    const feedbackSummaries = new Map<string, string>();
    let lastSavedRevision = -1;
    let saveChain: Promise<void> = Promise.resolve();
    let deadline: ReturnType<typeof setTimeout>;

    const sendChild = (event: unknown) => {
      if (child.readyState !== WebSocket.OPEN) return;
      if (child.bufferedAmount > 2 * 1024 * 1024) { close(); return; }
      child.send(JSON.stringify(event));
    };
    const close = () => {
      if (state === "closed") return;
      state = "closed";
      clearTimeout(deadline);
      clearTimeout(lifetime);
      active.delete(close);
      cloud.terminate();
      child.close();
    };
    const fail = () => { sendChild({ type: "error", message: "学习连接中断，请停止后重试；画布仍保留。" }); close(); };
    const timeout = (ms: number) => { clearTimeout(deadline); deadline = setTimeout(fail, ms); };
    const lifetime = setTimeout(fail, 20 * 60_000);
    active.add(close);
    timeout(10_000);
    const send = (event: Record<string, unknown>) => {
      if (cloud.readyState !== WebSocket.OPEN || cloud.bufferedAmount > 2 * 1024 * 1024) throw Error("notReady");
      cloud.send(JSON.stringify({ event_id: randomUUID(), ...event }));
    };

    /** 落一条事实记录。revision 取 max(会话 revision, 已存+1)：反馈事实不推进会话 revision 也必须单调递增。 */
    const persist = (eventId: string) => {
      if (!store || !session) return;
      const current = session;
      saveChain = saveChain.then(async () => {
        const revision = Math.max(current.revision, lastSavedRevision + 1);
        const snap = current.snapshot();
        const record: LearningSessionRecord = {
          schemaVersion: 1,
          sessionId: current.sessionId,
          eventId,
          packVersion: fractionPack.version,
          challengeId: current.currentAttempt.challengeId,
          phase: current.phase,
          revision,
          childInkBase64: lastChildInk,
          board: lastBoard,
          hintsVisible: lastBoard.rectangles.some((r) => r.owner === "agent"),
          hintUsed: current.currentAttempt.hintUsed,
          submissions: snap.submissions,
          feedback: snap.feedback.map((f) => ({ ...f, summary: (feedbackSummaries.get(f.feedbackId) ?? "").slice(0, 4000) })),
        };
        try {
          const result = await store.save(record);
          if (result.ok) lastSavedRevision = revision;
          else sendChild({ type: "error", message: `学习记录保存失败（${result.reason}），本次进度可能未保存。` });
        } catch {
          sendChild({ type: "error", message: "学习记录保存失败（写入错误），本次进度可能未保存。" });
        }
      });
    };

    const initFresh = () => {
      session = new FractionSession({ sessionId: randomUUID(), pack: fractionPack });
      actions = new TutorLearningActions(session.sessionId);
      restored = false;
    };

    /** 恢复路径：记录存在则完整还原；缺失/墓碑/损坏一律按新会话处理（新 sessionId，不复活旧数据）。 */
    const initFromHello = async (requestedId: unknown) => {
      if (typeof requestedId === "string" && store) {
        try {
          const loaded = await store.load(requestedId);
          if (loaded.status === "ok") {
            const record = loaded.record;
            const challenge = getChallenge(record.challengeId);
            const working: "exploring" | "transfer" = challenge?.role === "transfer" ? "transfer" : "exploring";
            const restoredSession = FractionSession.restore({
              sessionId: record.sessionId,
              pack: fractionPack,
              snapshot: {
                phase: record.phase,
                revision: record.revision,
                currentAttempt: { challengeId: record.challengeId, hintUsed: record.hintUsed },
                submissions: record.submissions,
                appliedEventIds: [record.eventId], // 更早的事件已被 revision 校验挡掉
                feedback: record.feedback.map((f) => ({ feedbackId: f.feedbackId, submissionId: f.submissionId, contested: f.contested })),
                originPhase: working,
                pausedFrom: (record.phase === "paused" ? working : record.phase) as Exclude<FractionPhase, "paused">,
              },
            });
            session = restoredSession;
            actions = new TutorLearningActions(restoredSession.sessionId);
            restored = true;
            lastChildInk = record.childInkBase64;
            lastBoard = record.board;
            lastSavedRevision = record.revision;
            for (const f of record.feedback) feedbackSummaries.set(f.feedbackId, f.summary);
            // reviewing 中恢复：动作校验绑定到最后一次提交，迟到工具调用仍按该提交的画布校验
            const last = restoredSession.submissions.at(-1);
            if (restoredSession.phase === "reviewing" && last) {
              actions.bindSubmission(last, record.board);
              activeSubmissionId = last.submissionId;
            }
            return;
          }
        } catch {
          // 存档读取/还原异常不阻断学习：按新会话处理
        }
      }
      initFresh();
    };

    /** 按钮打断/异议/暂停共用取消路径：停生成、屏蔽旧响应片段，迟到增量由 cancelledResponses/dropUntilDone 拦截。 */
    const cancelResponse = (reason: string) => {
      if (state === "committing") {
        answerAfterCommit = false;
        sendChild({ type: "interrupted", responseId: null, reason });
        return; // 等待本次 commit 确认，避免迟到确认被下一次提交认领。
      }
      if (state !== "responding" || !currentResponseId) return;
      cancelledResponses.add(currentResponseId);
      dropUntilDone = true;
      try { send({ type: "response.cancel" }); } catch { /* 连接异常由 close/fail 路径处理 */ }
      sendChild({ type: "interrupted", responseId: currentResponseId, reason });
      state = "ready";
      timeout(60_000);
    };

    const processToolCall = (call: { callId: string; name: string; args: string }) => {
      const actionType = TOOL_TO_ACTION[call.name];
      let output: Record<string, unknown>;
      if (!actionType || !session || !actions) {
        output = { applied: false, reason: "unknownAction" };
      } else if (!activeSubmissionId) {
        // 切题/异议后迟到的工具调用：旧提交图形不得应用到新画布
        output = { applied: false, reason: "noActiveSubmission" };
      } else {
        let args: unknown;
        try { args = JSON.parse(call.args); } catch { args = null; }
        if (!args || typeof args !== "object") {
          output = { applied: false, reason: "invalidArguments" };
        } else {
          const result = actions.apply({
            ...(args as Record<string, unknown>),
            actionId: call.callId,
            sessionId: session.sessionId,
            submissionId: activeSubmissionId,
            boardRevision: actions.boardRevision,
            type: actionType,
          });
          if (result.ok) {
            if (!result.duplicate) {
              sendChild({ type: "action", responseId: currentResponseId, submissionId: activeSubmissionId, boardRevision: result.boardRevision, command: result.command });
            }
            lastBoard = actions.snapshot() ?? lastBoard; // AI 图形落进存档画布状态
            output = { applied: true, duplicate: result.duplicate, boardRevision: result.boardRevision };
          } else {
            output = { applied: false, reason: result.reason };
          }
        }
      }
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.callId, output: JSON.stringify(output) } });
      send({ type: "response.create" });
    };

    const handleEnvelope = (raw: Record<string, unknown>) => {
      const eventId = typeof raw.eventId === "string" ? raw.eventId : null;
      if (!session || !actions) { sendChild({ type: "rejected", eventId, reason: "sessionNotReady" }); return; }
      const current = session;
      const parsed = fractionEnvelopeSchema.safeParse(raw);
      if (!parsed.success) { sendChild({ type: "rejected", eventId, reason: "invalidEnvelope" }); return; }
      const envelope = parsed.data;
      if (state === "committing" && (envelope.type === "submit" || envelope.type === "requestHelp")) {
        sendChild({ type: "rejected", eventId, reason: "submissionPending" });
        return;
      }
      // submit 先冻结证据（submissionId + boardRevision + 快照引用）再进入状态机；证据不合法的提交不产生状态变化
      let evidenceImage: string | null = null;
      let evidenceBoardState: FractionBoard | null = null;
      if (envelope.type === "submit") {
        const image = raw.image;
        const boardParsed = fractionBoardSchema.safeParse(raw.board);
        if (typeof image !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 250_000 || !boardParsed.success) {
          sendChild({ type: "rejected", eventId, reason: "missingEvidence" });
          return;
        }
        if (boardParsed.data.revision !== envelope.payload.boardRevision) {
          sendChild({ type: "rejected", eventId, reason: "evidenceMismatch" });
          return;
        }
        evidenceImage = image;
        evidenceBoardState = boardParsed.data;
      }
      const result = current.apply(envelope);
      if (!result.ok) { sendChild({ type: "rejected", eventId, reason: result.reason }); return; }
      sendChild({ type: "accepted", eventId, command: envelope.type, duplicate: result.duplicate, revision: current.revision, phase: current.phase,
        ...(envelope.type === "submit" ? { submissionId: envelope.submissionId } : {}) });
      if (result.duplicate) return; // 同 eventId 重放不重复上行、不重复落盘（首次已存）
      switch (envelope.type) {
        case "submit": {
          const submission = current.submissions.at(-1)!;
          actions.bindSubmission(submission, evidenceBoardState!);
          activeSubmissionId = submission.submissionId;
          lastChildInk = evidenceImage!;
          lastBoard = evidenceBoardState!;
          persist(envelope.eventId);
          const challenge = getChallenge(submission.challengeId)!;
          // Omni 图片缓冲必须先有音频；按钮提交用 200ms PCM 静音承载协议，
          // 不是孩子的发言，不进入学习证据；已有真实音频时不补静音。
          if (audioBytes === 0) {
            send({ type: "input_audio_buffer.append", audio: Buffer.alloc(6400).toString("base64") });
          }
          send({ type: "input_image_buffer.append", image: evidenceImage! });
          send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: [
            `孩子主动提交了想法（submissionId=${submission.submissionId}，boardRevision=${submission.boardRevision}，hintUsed=${submission.hintUsed}）。`,
            `题目：${challenge.prompt}`,
            `孩子画布结构化状态：${JSON.stringify(evidenceBoardState!.rectangles)}。图片是孩子笔迹与图形的合成证据。`,
            "请先用一句话复述你理解的孩子想法。",
          ].join("\n") }] } });
          answerAfterCommit = true;
          state = "committing";
          send({ type: "input_audio_buffer.commit" });
          timeout(60_000);
          break;
        }
        case "requestHelp": {
          persist(envelope.eventId);
          const challenge = getChallenge(envelope.payload.challengeId)!;
          send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: [
            `孩子在题目「${challenge.prompt}」中主动求助。`,
            `可用提示（每次只给一小步，不要一次说完）：${JSON.stringify(challenge.hints)}`,
            "请先复述孩子目前的进展，再给一小步提示。",
          ].join("\n") }] } });
          send({ type: "response.create" });
          state = "responding";
          timeout(60_000);
          break;
        }
        case "contest":
          persist(envelope.eventId); // 异议事实随状态机落盘（feedback.contested 已置真）
          // 「你理解错了」：与按钮打断同一取消路径；被异议反馈已在状态机里失去使用资格
          cancelResponse("contest");
          break;
        case "startTransfer":
          activeSubmissionId = null;
          actions.clearSubmission();
          persist(envelope.eventId);
          cancelResponse("transfer");
          break;
        case "pause":
        case "resume":
          persist(envelope.eventId);
          if (envelope.type === "pause") cancelResponse("pause");
          break;
        case "finishSession":
          persist(envelope.eventId);
          cancelResponse("finish");
          break;
        default:
          break;
      }
    };

    child.on("close", close);
    child.on("error", close);
    cloud.on("error", fail);
    cloud.on("close", close);

    cloud.on("message", (raw) => {
      if (state === "closed") return;
      try {
        const e = JSON.parse(raw.toString());
        if (e.type === "error") throw Error();
        if (e.type === "session.created" && !configured) {
          configured = true;
          send({ type: "session.update", session: {
            modalities: ["text", "audio"], voice: "Tina", turn_detection: null,
            audio: { input: { format: { type: "pcm", sample_rate: 16000 } }, output: { format: { type: "pcm", sample_rate: 24000 } } },
            instructions: `${teacherSpeechStyle}\n${INSTRUCTIONS}`,
            tools: TUTOR_TOOLS,
            tool_choice: "auto",
          } });
          return;
        }
        if (e.type === "session.updated" && state === "connecting") {
          // 恢复请求（hello）可能已先到：等它落定再发 ready，保证 ready 里的 revision/phase 属于恢复后会话
          void (async () => {
            if (helloPromise) await helloPromise.catch(() => {});
            if (state !== "connecting") return;
            if (!session) initFresh();
            state = "ready";
            clearTimeout(deadline);
            const challenge = getChallenge(session!.currentAttempt.challengeId)!;
            sendChild({ type: "ready", sessionId: session!.sessionId, revision: session!.revision, phase: session!.phase,
              challengeId: challenge.id, prompt: challenge.prompt, restored, packVersion: fractionPack.version });
          })().catch(fail);
          return;
        }
        if (e.type === "input_audio_buffer.committed" && state === "committing") {
          audioBytes = 0;
          const shouldAnswer = answerAfterCommit;
          answerAfterCommit = false;
          state = shouldAnswer ? "responding" : "ready";
          if (shouldAnswer) send({ type: "response.create" });
          timeout(60_000);
          return;
        }
        if (e.type === "response.created") {
          currentResponseId = typeof e.response?.id === "string" ? e.response.id : `local-${++localResponseSeq}`;
          dropUntilDone = false;
          return;
        }
        if (e.type === "response.audio.delta" || e.type === "response.audio_transcript.delta") {
          const rid = typeof e.response_id === "string" ? e.response_id : currentResponseId;
          const cancelled = (rid !== null && cancelledResponses.has(rid)) || (dropUntilDone && typeof e.response_id !== "string");
          if (cancelled || typeof e.delta !== "string") return;
          if (rid && e.type === "response.audio_transcript.delta") {
            transcriptByResponse.set(rid, ((transcriptByResponse.get(rid) ?? "") + e.delta).slice(0, 4000));
          }
          sendChild(e.type === "response.audio.delta"
            ? { type: "audio", data: e.delta, responseId: rid }
            : { type: "text", text: e.delta, responseId: rid });
          return;
        }
        if (e.type === "input_audio_transcription.completed" && typeof e.transcript === "string") {
          // 语音提交只到「明确短语意图」为止：转发给孩子端确认，绝不自动等价于 submit
          const intent = matchVoiceIntent(e.transcript);
          if (intent) sendChild({ type: "voiceIntent", intent, transcript: e.transcript });
          return;
        }
        if (e.type === "response.function_call_arguments.done") {
          if (typeof e.call_id === "string" && typeof e.name === "string") {
            pendingCalls.push({ callId: e.call_id, name: e.name, args: typeof e.arguments === "string" ? e.arguments : "" });
          }
          return;
        }
        if (e.type === "response.done") {
          const status = String(e.response?.status ?? "unknown");
          const rid = typeof e.response?.id === "string" ? e.response.id : currentResponseId;
          if (rid) cancelledResponses.delete(rid);
          dropUntilDone = false;
          if (status === "completed") {
            if (activeSubmissionId && session?.phase === "reviewing" && rid) {
              session.recordFeedback({ feedbackId: rid, submissionId: activeSubmissionId });
              feedbackSummaries.set(rid, transcriptByResponse.get(rid) ?? "");
              sendChild({ type: "feedback", feedbackId: rid, submissionId: activeSubmissionId });
              persist(`feedback-${rid}`); // AI 可见反馈事实落盘（summary 取可见转写，不含隐藏推理）
            }
            const calls = pendingCalls.splice(0);
            if (calls.length) {
              for (const call of calls) processToolCall(call);
              return; // state 保持 responding，等待工具结果后的下一轮 response.done
            }
            state = "ready";
            timeout(60_000);
          } else if (status === "cancelled") {
            pendingCalls.length = 0;
            state = "ready";
            timeout(60_000);
          } else {
            throw Error(`responseStatus:${status}`);
          }
          sendChild({ type: "responseDone", responseId: rid, status });
          return;
        }
      } catch { fail(); }
    });

    child.on("message", (raw, binary) => {
      if (state === "closed") return;
      try {
        if (binary) {
          const pcm = Buffer.from(raw as Buffer);
          // 音频只进缓冲；没有任何音频事件会触发 response.create
          if ((state !== "ready" && state !== "responding") || !pcm.length || pcm.length > 3200 || pcm.length % 2 || audioBytes + pcm.length > 960_000) throw Error("badAudio");
          audioBytes += pcm.length;
          send({ type: "input_audio_buffer.append", audio: pcm.toString("base64") });
          return;
        }
        const e = JSON.parse(raw.toString());
        if (e.type === "hello") {
          // 恢复请求只在上游就绪前有效；会话已建立后迟到的一律不采用
          if (session) sendChild({ type: "error", message: "会话已建立，恢复请求过晚未被采用。" });
          else helloPromise = initFromHello(e.sessionId);
        } else if (e.type === "commitAudio" && state === "ready") {
          send({ type: "input_audio_buffer.commit" });
          audioBytes = 0;
        } else if (e.type === "interrupt") {
          cancelResponse("interrupt");
        } else if (typeof e.type === "string" && typeof e.schemaVersion === "number") {
          handleEnvelope(e);
        }
        // 其余消息（画布同步、心跳等）一律忽略，绝不触发教学响应
      } catch { fail(); }
    });
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let config: QwenConfig | null = null;
  try { config = loadQwenConfig(); } catch { console.log("千问未配置；启动本地配置提示入口，不连接云端。"); }
  const workspaceStore = new WorkspaceStore();
  const hostId = await loadHostIdentity(workspaceStore.directory);
  const app = await buildLearningTutor(config, { store: new LearningSessionStore(), workspaceStore, hostId });
  let stopDiscovery = () => {};
  app.addHook("onClose", async () => stopDiscovery());
  await app.listen({ host: "0.0.0.0", port: 8791 });
  stopDiscovery = advertiseHost(hostId);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void app.close().finally(() => process.exit(0)); });
  console.log("分数学习练习宿主已启动，端口 8791；配置状态见 /healthz。");
}
