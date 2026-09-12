import type { GrowthAssentPort, GrowthSessionPort } from "./ports.js";
import type { MemoryCommitDecision } from "./types.js";

const unavailable = (): never => { throw new Error("growthLedgerUnavailable"); };
const session: GrowthSessionPort = Object.freeze({
  activeModel: () => [], referencedEventIds: () => new Set<string>(), ingestRun: () => ({ linkCount: 0 }),
  personalizationInputs: () => [], dueReviews: () => [],
  blockedHypothesisKeys: () => [],
  recordProposalContext: () => {},
  ingestArtifactVersion: (input: { artifactVersionId: string }) => ({ artifactVersionId: input.artifactVersionId }),
  buildAndPreflight: () => ({ candidate: null, decision: null }), nextCandidateToAsk: () => null,
  markPreviewShown: () => {}, evaluateAssent: (): { wouldCommit: boolean; draft: MemoryCommitDecision } => unavailable(),
  contest: () => ({ contestId: "", frozenClaimKeys: [] }), holdCandidate: () => {},
});
const assent: GrowthAssentPort = Object.freeze({ recordAssent: unavailable });
export const NULL_LEDGER = Object.freeze({ session, assent });
