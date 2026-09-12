import Foundation

enum MemoryAssentChoice: String, Codable, CaseIterable {
    case record, unsure, disagree
    var title: String {
        switch self {
        case .record: "记下来"
        case .unsure: "我不确定"
        case .disagree: "不是这样"
        }
    }
}

enum MemoryDismissReason: String, Codable { case held, recorded, unsure, disagree }

struct ContestTarget: Codable, Equatable {
    enum Kind: String, Codable { case candidate, record, proposal, hypothesis, session }
    let kind: Kind
    let id: String
}

struct MemoryPreview: Codable, Equatable, Identifiable {
    enum Tier: Int, Codable { case session = 2, longitudinal = 3 }
    let id: String
    let candidateId: String
    let previewNonce: String
    let tier: Tier
    let childFacingText: String
    let evidenceSummaryText: String
    let contestTarget: ContestTarget
}
