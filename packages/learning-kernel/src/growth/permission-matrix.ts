/** 主体与数据对象的职责边界；实际执行入口仍必须走对应端口及门禁。 */
export const PERMISSION_MATRIX = {
  child: {
    artifacts: ["createOwn", "readOwn"], hypotheses: ["readChildProjection"],
    capabilities: ["assent", "decline"], trends: ["assent", "decline"], rights: ["contest", "requestDeletion"],
  },
  parent: {
    artifacts: ["read", "export"], hypotheses: ["readEvidence"],
    capabilities: ["narrowScope", "downgrade", "retract", "delete"], trends: ["review"], rights: ["executeDeletion", "review"],
  },
  bridge: {
    artifacts: ["readMinimalContext"], hypotheses: ["proposeCandidate"], capabilities: [], trends: [], rights: [],
  },
  plugin: {
    artifacts: ["interpretEvidence", "verifyTransfer"], hypotheses: ["provideEvidenceDirection"], capabilities: [], trends: [], rights: [],
  },
  service: {
    artifacts: ["ingest", "retain"], hypotheses: ["transition"],
    capabilities: ["commitAfterAssentAndGate"], trends: ["commitAfterReviewAssentAndGate"], rights: ["freeze", "cascade", "audit"],
  },
} as const;
