import type { BuildLinksInput } from "./evidence-fold.js";
import type { BridgeCandidate } from "./candidate.js";
import type { ChallengeRun, ContestTarget, GrowthRecord, MemoryCandidate, MemoryCommitDecision, SessionGateSnapshot } from "./types.js";
import type { SessionState } from "../session-state.js";
import type { TrendReport } from "./scaffold-trend.js";
import type { ChildFacingView, HypothesisRow } from "./views.js";
import type { DisciplinePluginManifest } from "../plugin.js";
import type { DueReview } from "../challenge.js";
import type { DeletionInput, DeletionPreview } from "./deletion.js";
export type DeletionSubject = DeletionInput["subject"];
export interface DeletionRequestView { requestId: string; status: string; subjectKind: string; subjectId: string; escalated: boolean; requestedAt: number; preview: DeletionPreview }

export interface BuildCandidateInput {
  learnerId: string;
  run: ChallengeRun;
  snapshot: SessionGateSnapshot;
  bridgeCandidate?: BridgeCandidate | null | undefined;
  bridgeCandidateRejected?: boolean | undefined;
  plugin: { forbiddenClaimPatterns: readonly string[]; knownHypothesisKeys: readonly string[] };
}
export interface AssentInput {
  learnerId: string;
  candidateId: string;
  previewNonce: string;
  choice: "record" | "unsure" | "disagree";
  eventId: string;
  answeredAt: number;
  snapshot: SessionGateSnapshot;
}
export interface RecordAssentInput extends AssentInput {
  transitionAccepted: boolean;
  stateAfterTransition: SessionState;
}
export interface ContestInput {
  learnerId: string;
  target: ContestTarget;
  sessionId: string;
  runId: string | null;
  eventId: string;
}
export interface ArtifactInput {
  learnerId: string; artifactId: string; artifactVersionId: string; sessionId: string; discipline: string;
  versionNo: number; writer: "host_snapshot" | "child_upload"; contentRef: string; contentHash: string; payload: unknown;
}
export interface GrowthReadPort {
  blockedHypothesisKeys(learnerId: string, discipline: string): readonly string[];
  activeModel(learnerId: string, discipline: string): readonly GrowthRecord[];
  referencedEventIds(): ReadonlySet<string>;
  personalizationInputs(learnerId: string, discipline: string): readonly HypothesisRow[];
  dueReviews(learnerId: string, discipline: string, now: number): readonly DueReview[];
}
export interface GrowthSessionPort extends GrowthReadPort {
  ingestRun(input: BuildLinksInput & { learnerId: string; pluginPolicy?: BuildCandidateInput["plugin"] }): { linkCount: number };
  recordProposalContext(learnerId: string, proposalId: string, hypothesisKeys: readonly string[]): void;
  ingestArtifactVersion(input: ArtifactInput): { artifactVersionId: string };
  buildAndPreflight(input: BuildCandidateInput): { candidate: MemoryCandidate | null; decision: MemoryCommitDecision | null };
  nextCandidateToAsk(learnerId: string, discipline: string, snapshot: SessionGateSnapshot): MemoryCandidate | null;
  markPreviewShown(learnerId: string, candidateId: string, nonce: string, shownAt: number): void;
  evaluateAssent(input: AssentInput): { wouldCommit: boolean; draft: MemoryCommitDecision };
  contest(input: ContestInput): { contestId: string; frozenClaimKeys: readonly string[] };
  holdCandidate(learnerId: string, candidateId: string): void;
}
export interface GrowthAssentPort {
  recordAssent(input: RecordAssentInput): MemoryCommitDecision;
}
export interface GrowthChildPort {
  acknowledgeFirstUse(learnerId: string): void;
  firstUseAcknowledged(learnerId: string): boolean;
  records(learnerId: string): readonly GrowthRecord[];
  contest(input: ContestInput): { contestId: string; frozenClaimKeys: readonly string[] };
  understanding(learnerId: string, manifest: DisciplinePluginManifest): ChildFacingView;
  deletionPreview(learnerId: string, subject: DeletionSubject): { preview: DeletionPreview; text: string; previewComputedAt: number };
  requestDeletion(learnerId: string, subject: DeletionSubject): { requestId: string; preview: DeletionPreview };
  deletionRequests(learnerId: string): readonly DeletionRequestView[];
  withdrawDeletion(learnerId: string, requestId: string): void;
  notifications(learnerId: string): readonly { notificationId: string; text: string; read: boolean }[];
  readNotification(learnerId: string, notificationId: string): void;
}
export interface GrowthParentPort {
  pendingReviews(learnerId: string, manifest: DisciplinePluginManifest): readonly {
    candidate: MemoryCandidate; trend: TrendReport | null; runs: readonly ChallengeRun[];
    hypotheses: readonly (HypothesisRow & { parentFacingLabel: string })[];
    artifactLinks: readonly { artifactId: string; href: string }[];
    childFacingText: string; blocked: readonly string[];
  }[];
  artifactEvidence(learnerId: string, artifactId: string): {
    artifactId: string; sessionId: string; previewAvailable: false; previewReason: string;
    versions: readonly Record<string, unknown>[]; events: readonly unknown[];
  } | null;
  records(learnerId: string): readonly GrowthRecord[];
  narrowScope(learnerId: string, recordId: string, scope: { toBandIndex?: number; toSurfaceContextKey?: string }): { needsReassent: true; candidateId: string };
  downgrade(learnerId: string, recordId: string): void;
  retract(learnerId: string, recordId: string): void;
  exportArchive(learnerId: string): object;
  acknowledgeAlert(learnerId: string, signalId: string): void;
  agentView(learnerId: string): object;
  candidates(learnerId: string): readonly MemoryCandidate[];
  review(learnerId: string, candidateId: string, decision: "approved" | "rejected", parentNote?: string): { reviewId: string };
  trends(learnerId: string): readonly { goalId: string; probeFamilyId: string; report: TrendReport }[];
  alerts(learnerId: string): readonly { signalId: string; kind: string; subjectId: string; count: number; createdAt: number }[];
  deletionPreview(learnerId: string, subject: DeletionSubject): { preview: DeletionPreview; text: string; previewComputedAt: number };
  deletionRequests(learnerId: string): readonly DeletionRequestView[];
  resolveDeletion(learnerId: string, requestId: string, decision: "approved" | "rejected"): { auditId: string | null };
  executeDeletion(learnerId: string, subject: DeletionSubject, preview: DeletionPreview): { auditId: string };
}
