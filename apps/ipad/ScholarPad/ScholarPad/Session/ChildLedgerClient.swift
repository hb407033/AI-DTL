import Foundation

struct ChildFirstUseNotice: Decodable {
    let version: Int
    let text: String
    let acknowledged: Bool
}

struct ChildUnderstanding: Decodable {
    struct Question: Decodable { let at: Double; let text: String }
    struct Exploration: Decodable { let at: Double; let label: String }
    struct Artifact: Decodable { let artifactId: String; let versionNo: Int; let at: Double }
    struct Method: Decodable { let recordId: String; let text: String }
    struct Guess: Decodable { let text: String; let contestTarget: ContestTarget }
    struct Record: Decodable { let recordId: String; let text: String; let contestTarget: ContestTarget; let canRequestDeletion: Bool }
    struct DeletionRequest: Decodable { let requestId: String; let status: String; let outcomeText: String? }
    let myQuestions: [Question]
    let myExplorations: [Exploration]
    let myArtifacts: [Artifact]
    let myCorrectedGuesses: [Question]
    let myNewMethods: [Method]
    let activeGuesses: [Guess]
    let scaffoldLine: String
    let records: [Record]
    let deletionRequests: [DeletionRequest]
    let firstUseAcknowledged: Bool
}

struct ChildDeletionSubject: Codable, Equatable {
    enum Kind: String, Codable { case artifact; case growthRecord = "growth_record" }
    let subjectKind: Kind
    let subjectId: String
}

struct ChildDeletionPreview: Decodable {
    let preview: [String: Int]
    let text: String
    let previewComputedAt: Double
}

struct ChildDeletionReceipt: Decodable {
    let requestId: String
    let preview: [String: Int]
}

/// 儿童权利接口独立于学习事件队列，不创建会话、不消耗 clientSeq。
struct ChildLedgerClient {
    let baseURL: URL
    private let session: URLSession

    init(webSocketURL: URL, session: URLSession = .shared) throws {
        baseURL = try Self.httpBaseURL(webSocketURL: webSocketURL)
        self.session = session
    }

    static func httpBaseURL(webSocketURL: URL) throws -> URL {
        guard var parts = URLComponents(url: webSocketURL, resolvingAgainstBaseURL: false),
              ["ws", "wss"].contains(parts.scheme), parts.host != nil else { throw URLError(.badURL) }
        parts.scheme = parts.scheme == "wss" ? "https" : "http"
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        guard let url = parts.url else { throw URLError(.badURL) }
        return url
    }

    func understanding() async throws -> ChildUnderstanding { try await get("understanding") }
    func firstUseNotice() async throws -> ChildFirstUseNotice { try await get("first-use-notice") }
    func acknowledgeNotice(version: Int) async throws {
        _ = try await request("first-use-notice/ack", body: JSONEncoder().encode(["version": version]))
    }
    func contest(_ target: ContestTarget) async throws {
        _ = try await request("contest", body: JSONEncoder().encode(["target": target]))
    }
    func deletionPreview(_ subject: ChildDeletionSubject) async throws -> ChildDeletionPreview {
        try JSONDecoder().decode(ChildDeletionPreview.self, from: await request("deletion-preview", body: JSONEncoder().encode(subject)))
    }
    func requestDeletion(_ subject: ChildDeletionSubject) async throws -> ChildDeletionReceipt {
        try JSONDecoder().decode(ChildDeletionReceipt.self, from: await request("deletion-requests", body: JSONEncoder().encode(subject)))
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try JSONDecoder().decode(T.self, from: await request(path))
    }

    private func request(_ path: String, body: Data? = nil) async throws -> Data {
        #if DEBUG
        if let fixtures = ProcessInfo.processInfo.environment["SCHOLARPAD_TEST_CHILD_LEDGER"],
           let responses = try? JSONDecoder().decode([String: String].self, from: Data(fixtures.utf8)),
           let response = responses[path] {
            return Data(response.utf8)
        }
        #endif
        var request = URLRequest(url: baseURL.appending(path: "child/\(path)"))
        request.httpMethod = body == nil ? "GET" : "POST"
        request.httpBody = body
        request.timeoutInterval = 15
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(response.statusCode) else { throw LedgerError.http(response.statusCode) }
        return data
    }

    enum LedgerError: LocalizedError {
        case http(Int)
        var errorDescription: String? {
            switch self { case .http(let status): "这次请求没有完成（\(status)）。可以稍后再试。" }
        }
    }
}
