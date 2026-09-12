import type { EvidenceEvent } from "@ai-scholar/session-contracts";
import type { DisciplinePluginManifest } from "../plugin.js";
import type { GrowthRecord, ContestTarget, DiscreteCounts, JudgementStatus } from "./types.js";
import type { ScaffoldPointRow } from "./scaffold-trend.js";
import { renderScaffoldLine } from "./child-text.js";

export interface HypothesisRow {
  hypothesisKey: string; discipline: string; status: JudgementStatus; counts: DiscreteCounts;
  stopsDrivingPersonalization: boolean; lastObservedAt: number | null; expiresAt: number | null;
}
export interface ChildFacingView {
  myQuestions: readonly { at: number; text: string }[];
  myExplorations: readonly { at: number; label: string }[];
  myArtifacts: readonly { artifactId: string; versionNo: number; at: number }[];
  myCorrectedGuesses: readonly { at: number; text: string }[];
  myNewMethods: readonly { recordId: string; text: string }[];
  activeGuesses: readonly { text: string; contestTarget: ContestTarget }[];
  scaffoldLine: string;
  records: readonly { recordId: string; text: string; contestTarget: ContestTarget; canRequestDeletion: true }[];
  deletionRequests: readonly { requestId: string; status: string; outcomeText: string | null }[];
  firstUseAcknowledged: boolean;
}

export function childFacingView(input: {
  events: readonly EvidenceEvent[]; records: readonly GrowthRecord[]; hypotheses: readonly HypothesisRow[];
  points: readonly ScaffoldPointRow[]; artifacts: ChildFacingView["myArtifacts"]; manifest: DisciplinePluginManifest;
  deletionRequests: ChildFacingView["deletionRequests"]; firstUseAcknowledged: boolean;
}): ChildFacingView {
  const active = input.records.filter(record => record.status === "confirmed" && record.suppressedReason === null);
  return {
    myQuestions: input.events.flatMap(event => event.payload.type === "UTTERANCE" && /[?？]/u.test(event.payload.text) ? [{ at: event.occurredAt, text: event.payload.text }] : []),
    myExplorations: input.events.filter(event => ["STROKE", "DRAG", "SELECT"].includes(event.payload.type)).map(event => ({ at: event.occurredAt, label: "我试过一种表示方法" })),
    myArtifacts: input.artifacts,
    myCorrectedGuesses: input.points.filter(point => point.selfCorrectionObserved).map(point => ({ at: point.occurredAt, text: "我自己发现了需要调整的地方" })),
    myNewMethods: active.map(record => ({ recordId: record.recordId, text: record.childFacingText })),
    activeGuesses: input.hypotheses.filter(row => !row.stopsDrivingPersonalization && ["suspected", "confirmed"].includes(row.status)).flatMap(row => {
      const entry = input.manifest.hypothesisCatalog.find(item => item.id === row.hypothesisKey);
      return entry ? [{ text: entry.childFacingGuess, contestTarget: { kind: "hypothesis" as const, id: row.hypothesisKey } }] : [];
    }),
    scaffoldLine: renderScaffoldLine(input.points.filter(point => point.independentTransferSucceeded && point.maxHintLevelUsed === 0).length, input.points.length),
    records: input.records.filter(record => record.status !== "evidence_removed").map(record => ({ recordId: record.recordId,
      text: record.suppressedReason ? "这条我先不用了，等爸爸妈妈看一下。" : record.childFacingText,
      contestTarget: { kind: "record", id: record.recordId }, canRequestDeletion: true })),
    deletionRequests: input.deletionRequests, firstUseAcknowledged: input.firstUseAcknowledged,
  };
}

export function parentFacingView(input: { points: readonly ScaffoldPointRow[]; hypotheses: readonly HypothesisRow[]; records: readonly GrowthRecord[] }) {
  return { independence: input.points, hypotheses: input.hypotheses, records: input.records,
    discussionQuestions: ["哪些帮助已经可以慢慢撤去了？", "孩子希望系统怎样理解这次尝试？"] };
}

export function agentFacingView(input: { hypotheses: readonly HypothesisRow[]; records: readonly GrowthRecord[]; points: readonly ScaffoldPointRow[] }) {
  return { activeHypotheses: input.hypotheses.filter(row => !row.stopsDrivingPersonalization),
    transferResults: input.records.flatMap(record => record.transferRefs),
    hintHistory: input.points.map(point => ({ runId: point.runId, level: point.maxHintLevelUsed, at: point.occurredAt })),
    nextChallengeCandidates: input.records.map(record => ({ kind: "dueReview" as const, ref: record.recordId })) };
}
