import type { EventPayload } from "@ai-scholar/session-contracts";
import type { LearningChallenge } from "../challenge.js";
import type { ProposalRecord, SessionSnapshot } from "../store.js";

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export interface RetentionPlan { redactEventIds: string[]; redactProposalIds: string[] }
export function planRetentionPrune(input: {
  now: number;
  events: readonly { eventId: string; receivedAt: number; redacted: boolean }[];
  referencedEventIds: ReadonlySet<string>;
  proposals: readonly { proposalId: string; decidedAt: number; accepted: boolean; redacted: boolean }[];
}): RetentionPlan {
  const cutoff = input.now - RETENTION_MS;
  return {
    redactEventIds: input.events.filter(e => !e.redacted && e.receivedAt <= cutoff && !input.referencedEventIds.has(e.eventId)).map(e => e.eventId).sort(),
    redactProposalIds: input.proposals.filter(p => !p.redacted && p.decidedAt <= cutoff).map(p => p.proposalId).sort(),
  };
}

export function redactEventPayload(payload: EventPayload): EventPayload {
  switch (payload.type) {
    case "UTTERANCE": case "ANSWER": case "EXPLAIN": return { ...payload, text: "" };
    case "CONFIRM_TRANSCRIPT": return payload.correctedText === undefined ? { ...payload } : { ...payload, correctedText: "" };
    default: return structuredClone(payload);
  }
}

function redactChallenge(challenge: LearningChallenge): LearningChallenge {
  const safe = structuredClone(challenge);
  safe.curriculumAnchor = ""; safe.developmentGoal = ""; safe.childFacingGoalPhrase = "";
  safe.surfaceContextLabel = ""; safe.learnerPrompt = "（已删除）"; safe.expectedEvidence = [];
  for (const level of [1, 2, 3, 4] as const) safe.hintLadder[level] = { spokenResponse: "", learnerTask: "", canvasActions: [] };
  safe.explainBackSpec = { prompt: "", requiredElements: [] };
  safe.transferSpec = { description: "", passCriteria: "" };
  return safe;
}

export function redactSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  const safe = structuredClone(snapshot);
  safe.challenge = redactChallenge(safe.challenge);
  if (safe.transferChallenge) safe.transferChallenge = redactChallenge(safe.transferChallenge);
  safe.evidence = safe.evidence.map(e => ({ ...e, summary: "" }));
  if (safe.runtime) {
    safe.runtime.lastSpoken = null; safe.runtime.lastLearnerTask = ""; safe.runtime.agentObjects = [];
    delete safe.runtime.lastTaskContestTarget; delete safe.runtime.lastSpeakContestTarget;
    delete safe.runtime.memoryPreview;
    if (safe.runtime.runRecorder?.run) {
      safe.runtime.runRecorder.run.childFacingGoalPhrase = "";
      safe.runtime.runRecorder.run.surfaceContextLabel = "";
    }
  }
  // 删除预览后不能等待一张已不存在的同意卡片。
  if (safe.context.state === "MEMORY_PENDING" || safe.context.priorState === "MEMORY_PENDING") {
    safe.context.state = "COMPLETED"; safe.context.priorState = null;
  }
  return safe;
}

export function redactProposalForStorage(record: ProposalRecord): ProposalRecord {
  const safe = structuredClone(record);
  safe.proposal.spokenResponse = "";
  safe.proposal.learnerTask = "（已删除）";
  safe.proposal.canvasActions = [];
  safe.proposal.expectedEvidence = [];
  delete safe.proposal.memoryCandidate;
  return safe;
}
