import { describe, expect, it } from "vitest";
import { planDeletionCascade, previewDeletion, type DeletionInput } from "../../src/growth/deletion.js";
import type { ChallengeRun, GrowthRecord, MemoryCandidate } from "../../src/growth/types.js";

function input(): DeletionInput {
  return { subject: { kind: "artifact", id: "a" }, now: 100,
    artifactVersions: [{ artifactId: "a", artifactVersionId: "v1", contentRef: "/private/a" }, { artifactId: "a", artifactVersionId: "v2", contentRef: "/private/a" }],
    runs: [{ runId: "run", sessionId: "s", artifactVersionIds: ["v1"], firstServerSeq: 2, lastServerSeq: 4 } as unknown as ChallengeRun],
    links: [], records: [], points: [], assents: [], reviews: [], decisions: [], hypotheses: [], candidates: [],
    events: [{ sessionId: "s", eventId: "voice", serverSeq: 1, artifactVersionId: "v2" }, { sessionId: "s", eventId: "interval", serverSeq: 3, artifactVersionId: null }, { sessionId: "other", eventId: "safe", serverSeq: 3, artifactVersionId: null }],
    snapshots: [{ sessionId: "s", snapshotSeq: 9 }, { sessionId: "other", snapshotSeq: 9 }],
    proposals: [{ sessionId: "s", proposalId: "p", runId: "run" }],
  };
}

describe("deletion planner", () => {
  it("covers the full version chain and unlinked voice, scopes event ranges to their session", () => {
    const data = input(), before = structuredClone(data), plan = planDeletionCascade(data);
    expect(plan.removeArtifactVersionIds).toEqual(["v1", "v2"]);
    expect(plan.removeContentRefs).toEqual(["/private/a"]);
    expect(plan.redactEventIds).toEqual(["interval", "voice"]);
    expect(plan.redactSnapshotKeys).toEqual([{ sessionId: "s", snapshotSeq: 9 }]);
    expect(plan.redactProposalIds).toEqual(["p"]);
    expect(previewDeletion(data).redactEventIds).toBe(2);
    expect(JSON.stringify(plan.audit)).not.toContain("/private/a");
    expect(data).toEqual(before);
  });
  it("record removal only invalidates that record and its own candidate decisions", () => {
    const data = input(); data.subject = { kind: "growth_record", id: "record" };
    data.records = [{ recordId: "record", decisionId: "d", evidenceLinkIds: [], transferRefs: [], trendRef: null }, { recordId: "other", decisionId: "other", evidenceLinkIds: [], transferRefs: [], trendRef: null }] as unknown as GrowthRecord[];
    data.candidates = [{ candidateId: "c", evidenceLinkIds: [] }] as unknown as MemoryCandidate[];
    data.decisions = [{ decisionId: "d", candidateId: "c", outcome: { recordId: "record" } }] as unknown as DeletionInput["decisions"];
    data.assents = [{ assentId: "yes", candidateId: "c" }]; data.reviews = [{ reviewId: "review", candidateId: "c" }];
    const plan = planDeletionCascade(data);
    expect(plan.invalidatedRecordIds).toEqual(["record"]);
    expect(plan.redactedCandidateIds).toEqual(["c"]);
    expect(plan.voidedAssentIds).toEqual(["yes"]);
    expect(plan.removeArtifactVersionIds).toEqual([]);
    expect(plan.redactEventIds).toEqual([]);
    expect(plan.evidenceRemovedLinkIds).toEqual([]);
  });
  it("invalidates linked authority and groups removed points into explicit trend gaps", () => {
    const data = input();
    data.links = [
      { linkId: "l", runId: "run", eventId: "interval", artifactVersionId: "v1", claimKey: "claim", hypothesisKey: "h", status: "active" },
      { linkId: "remaining", runId: "other", eventId: "safe", artifactVersionId: null, claimKey: "other", hypothesisKey: "kept", status: "active" },
      { linkId: "removed", runId: "run", eventId: "voice", artifactVersionId: "v2", claimKey: "other", hypothesisKey: "kept", status: "active" },
    ] as unknown as DeletionInput["links"];
    data.records = [{ recordId: "r", decisionId: "d", claimKey: "claim", evidenceLinkIds: ["l"], transferRefs: [], trendRef: null }] as unknown as DeletionInput["records"];
    data.candidates = [{ candidateId: "c", evidenceLinkIds: ["l"], transferRefs: [] }] as unknown as DeletionInput["candidates"];
    data.decisions = [{ decisionId: "d", candidateId: "c", outcome: { recordId: "r" } }] as unknown as DeletionInput["decisions"];
    data.hypotheses = [{ hypothesisKey: "h" }, { hypothesisKey: "kept" }];
    data.points = [1, 2].map(n => ({ pointId: `point-${n}`, learnerId: "child", runId: "run", goalId: "goal", probeFamilyId: "family", difficultyBandIndex: 1 })) as unknown as DeletionInput["points"];
    data.assents = [{ assentId: "a", candidateId: "c" }]; data.reviews = [{ reviewId: "p", candidateId: "c" }];
    const plan = planDeletionCascade(data);
    expect(plan.evidenceRemovedLinkIds).toEqual(["l", "removed"]);
    expect(plan.invalidatedRecordIds).toEqual(["r"]);
    expect(plan.retiredHypothesisKeys).toEqual(["h"]);
    expect(plan.voidedReviewIds).toEqual(["p"]);
    expect(plan.redactedDecisionIds).toEqual(["d"]);
    expect(plan.newTrendGaps).toHaveLength(1);
    expect(plan.newTrendGaps[0]).toMatchObject({ removedCount: 2, addedSinceCount: 0, removedAt: 100 });
    expect(planDeletionCascade(data)).toEqual(plan);
  });
  it("redacts legacy proposals with no run mapping only in affected sessions", () => {
    const data = input();
    data.proposals = [{ sessionId: "s", proposalId: "old", runId: null }, { sessionId: "other", proposalId: "keep", runId: null }];
    expect(planDeletionCascade(data).redactProposalIds).toEqual(["old"]);
  });
});
