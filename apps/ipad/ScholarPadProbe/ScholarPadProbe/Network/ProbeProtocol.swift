// 局域网探针协议 v1 的 Swift 侧类型。与 packages/gate-contracts/src/probe-protocol.ts 一一对应，夹具共用。
import Foundation

enum ProbeProtocol {
    static let version = 1
}

enum ClientMessageKind: String, Codable {
    case ping
    case requestSemanticAction
}

/// 客户端 → 网关。id 是幂等键，clientSeq 会话内单调递增；网关同一 id 只确认一次，序号缺口会被 nack 要求重放。
struct ClientMessage: Codable, Equatable {
    let protocolVersion: Int
    let type: ClientMessageKind
    let id: String
    let clientSeq: Int
    let sessionId: String
    let sentAt: Int64

    static func ping(id: String, clientSeq: Int, sessionId: String, sentAt: Int64) -> ClientMessage {
        ClientMessage(protocolVersion: ProbeProtocol.version, type: .ping, id: id, clientSeq: clientSeq, sessionId: sessionId, sentAt: sentAt)
    }
}

enum SemanticAction: Equatable {
    case upsertCircle(SemanticCircle)
}

/// 网关 → 客户端。未知类型或主版本不匹配一律解码失败，由调用方计一次拒绝。
enum ServerMessage: Equatable {
    case ack(id: String, clientSeq: Int, serverReceivedAt: Int64)
    case nack(reason: String, expectedSeq: Int)
    case semanticAction(id: String, inReplyTo: String, action: SemanticAction)
    case error(reason: String, id: String?)
}

extension ServerMessage: Decodable {
    private enum Keys: String, CodingKey { case protocolVersion, type, id, clientSeq, serverReceivedAt, reason, expectedSeq, inReplyTo, action }
    private enum ActionKeys: String, CodingKey { case kind, circle }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let version = try c.decode(Int.self, forKey: .protocolVersion)
        guard version == ProbeProtocol.version else {
            throw DecodingError.dataCorruptedError(forKey: .protocolVersion, in: c, debugDescription: "协议主版本不匹配：\(version)")
        }
        switch try c.decode(String.self, forKey: .type) {
        case "ack":
            self = .ack(id: try c.decode(String.self, forKey: .id),
                        clientSeq: try c.decode(Int.self, forKey: .clientSeq),
                        serverReceivedAt: try c.decode(Int64.self, forKey: .serverReceivedAt))
        case "nack":
            self = .nack(reason: try c.decode(String.self, forKey: .reason), expectedSeq: try c.decode(Int.self, forKey: .expectedSeq))
        case "semanticAction":
            let a = try c.nestedContainer(keyedBy: ActionKeys.self, forKey: .action)
            let action: SemanticAction
            switch try a.decode(String.self, forKey: .kind) {
            case "upsertCircle": action = .upsertCircle(try a.decode(SemanticCircle.self, forKey: .circle))
            case let other: throw DecodingError.dataCorruptedError(forKey: .kind, in: a, debugDescription: "未知语义动作：\(other)")
            }
            self = .semanticAction(id: try c.decode(String.self, forKey: .id), inReplyTo: try c.decode(String.self, forKey: .inReplyTo), action: action)
        case "error":
            self = .error(reason: try c.decode(String.self, forKey: .reason), id: try c.decodeIfPresent(String.self, forKey: .id))
        case let other:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "未知消息类型：\(other)")
        }
    }
}

/// 未确认消息队列：按 clientSeq 保序，ack 移除，重连或收到 nack 时从指定序号起重放。
struct OutboundQueue {
    let sessionId: String
    private(set) var nextSeq = 1
    private(set) var pending: [ClientMessage] = []

    init(sessionId: String) { self.sessionId = sessionId }

    mutating func enqueue(_ kind: ClientMessageKind, sentAt: Int64) -> ClientMessage {
        let message = ClientMessage(protocolVersion: ProbeProtocol.version, type: kind, id: UUID().uuidString,
                                    clientSeq: nextSeq, sessionId: sessionId, sentAt: sentAt)
        nextSeq += 1
        pending.append(message)
        return message
    }

    mutating func acknowledge(id: String) {
        pending.removeAll { $0.id == id }
    }

    func replayFrom(seq: Int) -> [ClientMessage] {
        pending.filter { $0.clientSeq >= seq }
    }
}
