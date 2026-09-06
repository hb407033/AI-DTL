// 儿童端 ⇄ 宿主 会话协议的 Swift 类型，与 packages/session-contracts/src 一一对应，夹具共用。
// 字段名与 TS 完全相同；带 type/kind 判别的联合类型手写 Codable 按判别字段分派；未知类型或主版本不符一律解码失败。
import Foundation

enum SessionProtocol {
    static let version = 1
}

enum EvidenceQuality: String, Codable, Equatable {
    case unconfirmed, confirmed, corrected
}

enum EvidenceSource: String, Codable, Equatable {
    case childTouch = "child_touch"
    case childVoice = "child_voice"
    case childButton = "child_button"
    case parentButton = "parent_button"
    case system
}

struct Point: Codable, Equatable {
    var x: Double
    var y: Double
}

struct StrokeBounds: Codable, Equatable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double
}

// MARK: - 证据事件

/// 15 种事件负载（设计稿 10.2）。高频触控点在客户端先聚合成一条 STROKE。
enum EventPayload: Equatable {
    case utterance(text: String)
    case stroke(strokeId: String, contentHash: String, bounds: StrokeBounds)
    case select(objectId: String)
    case drag(objectId: String, to: Point)
    case erase(strokeId: String, contentHash: String)
    case answer(text: String)
    case explain(text: String)
    case helpRequest
    case pauseRequest(by: String)
    case resumeRequest
    case contest(targetId: String?)
    case done
    case confirmTranscript(targetEventId: String, confirmed: Bool, correctedText: String?)
    case softLandingChoice(choice: String)
    case memoryAssent(choice: String)

    var type: String {
        switch self {
        case .utterance: "UTTERANCE"
        case .stroke: "STROKE"
        case .select: "SELECT"
        case .drag: "DRAG"
        case .erase: "ERASE"
        case .answer: "ANSWER"
        case .explain: "EXPLAIN"
        case .helpRequest: "HELP_REQUEST"
        case .pauseRequest: "PAUSE_REQUEST"
        case .resumeRequest: "RESUME_REQUEST"
        case .contest: "CONTEST"
        case .done: "DONE"
        case .confirmTranscript: "CONFIRM_TRANSCRIPT"
        case .softLandingChoice: "SOFT_LANDING_CHOICE"
        case .memoryAssent: "MEMORY_ASSENT"
        }
    }
}

extension EventPayload: Codable {
    private enum Keys: String, CodingKey {
        case type, text, strokeId, contentHash, bounds, objectId, to, by, targetId, targetEventId, confirmed, correctedText, choice
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "UTTERANCE": self = .utterance(text: try c.decode(String.self, forKey: .text))
        case "STROKE": self = .stroke(strokeId: try c.decode(String.self, forKey: .strokeId), contentHash: try c.decode(String.self, forKey: .contentHash), bounds: try c.decode(StrokeBounds.self, forKey: .bounds))
        case "SELECT": self = .select(objectId: try c.decode(String.self, forKey: .objectId))
        case "DRAG": self = .drag(objectId: try c.decode(String.self, forKey: .objectId), to: try c.decode(Point.self, forKey: .to))
        case "ERASE": self = .erase(strokeId: try c.decode(String.self, forKey: .strokeId), contentHash: try c.decode(String.self, forKey: .contentHash))
        case "ANSWER": self = .answer(text: try c.decode(String.self, forKey: .text))
        case "EXPLAIN": self = .explain(text: try c.decode(String.self, forKey: .text))
        case "HELP_REQUEST": self = .helpRequest
        case "PAUSE_REQUEST": self = .pauseRequest(by: try c.decode(String.self, forKey: .by))
        case "RESUME_REQUEST": self = .resumeRequest
        case "CONTEST": self = .contest(targetId: try c.decodeIfPresent(String.self, forKey: .targetId))
        case "DONE": self = .done
        case "CONFIRM_TRANSCRIPT": self = .confirmTranscript(targetEventId: try c.decode(String.self, forKey: .targetEventId), confirmed: try c.decode(Bool.self, forKey: .confirmed), correctedText: try c.decodeIfPresent(String.self, forKey: .correctedText))
        case "SOFT_LANDING_CHOICE": self = .softLandingChoice(choice: try c.decode(String.self, forKey: .choice))
        case "MEMORY_ASSENT": self = .memoryAssent(choice: try c.decode(String.self, forKey: .choice))
        case let other: throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "未知事件类型：\(other)")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        try c.encode(type, forKey: .type)
        switch self {
        case .utterance(let text), .answer(let text), .explain(let text):
            try c.encode(text, forKey: .text)
        case .stroke(let strokeId, let contentHash, let bounds):
            try c.encode(strokeId, forKey: .strokeId)
            try c.encode(contentHash, forKey: .contentHash)
            try c.encode(bounds, forKey: .bounds)
        case .select(let objectId):
            try c.encode(objectId, forKey: .objectId)
        case .drag(let objectId, let to):
            try c.encode(objectId, forKey: .objectId)
            try c.encode(to, forKey: .to)
        case .erase(let strokeId, let contentHash):
            try c.encode(strokeId, forKey: .strokeId)
            try c.encode(contentHash, forKey: .contentHash)
        case .pauseRequest(let by):
            try c.encode(by, forKey: .by)
        case .contest(let targetId):
            try c.encodeIfPresent(targetId, forKey: .targetId)
        case .confirmTranscript(let targetEventId, let confirmed, let correctedText):
            try c.encode(targetEventId, forKey: .targetEventId)
            try c.encode(confirmed, forKey: .confirmed)
            try c.encodeIfPresent(correctedText, forKey: .correctedText)
        case .softLandingChoice(let choice), .memoryAssent(let choice):
            try c.encode(choice, forKey: .choice)
        case .helpRequest, .resumeRequest, .done:
            break
        }
    }
}

struct EvidenceEvent: Equatable {
    var eventId: String
    var clientSessionId: String
    var deviceId: String
    var clientSeq: Int
    var occurredAt: Int64
    var quality: EvidenceQuality
    var source: EvidenceSource
    var semanticObjectIds: [String] = []
    var artifactVersion: String?
    var payload: EventPayload
}

extension EvidenceEvent: Codable {
    private enum Keys: String, CodingKey { case eventId, clientSessionId, deviceId, clientSeq, occurredAt, quality, source, semanticObjectIds, artifactVersion, payload }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        eventId = try c.decode(String.self, forKey: .eventId)
        clientSessionId = try c.decode(String.self, forKey: .clientSessionId)
        deviceId = try c.decode(String.self, forKey: .deviceId)
        clientSeq = try c.decode(Int.self, forKey: .clientSeq)
        occurredAt = try c.decode(Int64.self, forKey: .occurredAt)
        quality = try c.decode(EvidenceQuality.self, forKey: .quality)
        source = try c.decode(EvidenceSource.self, forKey: .source)
        semanticObjectIds = try c.decodeIfPresent([String].self, forKey: .semanticObjectIds) ?? []   // TS 端 default([])
        artifactVersion = try c.decodeIfPresent(String.self, forKey: .artifactVersion)
        payload = try c.decode(EventPayload.self, forKey: .payload)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        try c.encode(eventId, forKey: .eventId)
        try c.encode(clientSessionId, forKey: .clientSessionId)
        try c.encode(deviceId, forKey: .deviceId)
        try c.encode(clientSeq, forKey: .clientSeq)
        try c.encode(occurredAt, forKey: .occurredAt)
        try c.encode(quality, forKey: .quality)
        try c.encode(source, forKey: .source)
        try c.encode(semanticObjectIds, forKey: .semanticObjectIds)
        try c.encodeIfPresent(artifactVersion, forKey: .artifactVersion)
        try c.encode(payload, forKey: .payload)
    }
}

// MARK: - 客户端帧

/// 客户端 → 宿主。id 是幂等键，clientSeq 会话内单调递增；宿主同一 id 只确认一次，序号缺口会被 nack 要求重放。
struct ClientFrame: Codable, Equatable {
    var protocolVersion: Int = SessionProtocol.version
    var type: String = "event"
    var id: String
    var clientSeq: Int
    var sessionId: String
    var sentAt: Int64
    var event: EvidenceEvent
}

// MARK: - 语义对象与画布动作

/// 任意 JSON 值：语义对象的 props 由学科插件定义，儿童端只按 kind 取自己认识的键。
indirect enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else if let o = try? c.decode([String: JSONValue].self) { self = .object(o) }
        else { throw DecodingError.dataCorruptedError(in: c, debugDescription: "无法识别的 JSON 值") }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .null: try c.encodeNil()
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

/// Agent 层的语义对象。owner 只可能是 agent：Agent 永远拿不到孩子笔迹层。
struct SemanticObject: Codable, Equatable, Identifiable {
    var id: String
    var owner: String
    var kind: String
    var props: [String: JSONValue] = [:]

    private enum Keys: String, CodingKey { case id, owner, kind, props }

    init(id: String, owner: String, kind: String, props: [String: JSONValue] = [:]) {
        self.id = id
        self.owner = owner
        self.kind = kind
        self.props = props
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        id = try c.decode(String.self, forKey: .id)
        owner = try c.decode(String.self, forKey: .owner)
        kind = try c.decode(String.self, forKey: .kind)
        props = try c.decodeIfPresent([String: JSONValue].self, forKey: .props) ?? [:]
    }

    func number(_ key: String) -> Double? {
        if case .number(let n)? = props[key] { return n }
        return nil
    }

    func string(_ key: String) -> String? {
        if case .string(let s)? = props[key] { return s }
        return nil
    }
}

enum CanvasAction: Equatable {
    case upsertObject(SemanticObject)
    case highlight(objectId: String)
    case point(at: Point)
    case removeObject(objectId: String)
}

extension CanvasAction: Codable {
    private enum Keys: String, CodingKey { case kind, object, objectId, at }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "upsertObject": self = .upsertObject(try c.decode(SemanticObject.self, forKey: .object))
        case "highlight": self = .highlight(objectId: try c.decode(String.self, forKey: .objectId))
        case "point": self = .point(at: try c.decode(Point.self, forKey: .at))
        case "removeObject": self = .removeObject(objectId: try c.decode(String.self, forKey: .objectId))
        case let other: throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "未知画布动作：\(other)")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .upsertObject(let object):
            try c.encode("upsertObject", forKey: .kind)
            try c.encode(object, forKey: .object)
        case .highlight(let objectId):
            try c.encode("highlight", forKey: .kind)
            try c.encode(objectId, forKey: .objectId)
        case .point(let at):
            try c.encode("point", forKey: .kind)
            try c.encode(at, forKey: .at)
        case .removeObject(let objectId):
            try c.encode("removeObject", forKey: .kind)
            try c.encode(objectId, forKey: .objectId)
        }
    }
}

// MARK: - 宿主 → 儿童端

/// 儿童端能看到的全部输出：没有聊天历史、JSON、模型内部信息（设计稿 8.1）。
enum ChildOutbound: Equatable {
    case speak(id: String, text: String, hintLevel: Int, interruptible: Bool)
    case canvasAction(id: String, action: CanvasAction)
    case learnerTask(id: String, text: String)
    case stateChanged(id: String, state: String, hintLevel: Int, presence: String)
    case confirmTranscript(id: String, targetEventId: String, text: String)
    case softLanding(id: String, message: String, options: [String])
    case notice(id: String, text: String)
}

extension ChildOutbound: Decodable {
    private enum Keys: String, CodingKey { case type, id, text, hintLevel, interruptible, action, state, presence, targetEventId, message, options }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let id = try c.decode(String.self, forKey: .id)
        switch try c.decode(String.self, forKey: .type) {
        case "speak": self = .speak(id: id, text: try c.decode(String.self, forKey: .text), hintLevel: try c.decode(Int.self, forKey: .hintLevel), interruptible: try c.decode(Bool.self, forKey: .interruptible))
        case "canvasAction": self = .canvasAction(id: id, action: try c.decode(CanvasAction.self, forKey: .action))
        case "learnerTask": self = .learnerTask(id: id, text: try c.decode(String.self, forKey: .text))
        case "stateChanged": self = .stateChanged(id: id, state: try c.decode(String.self, forKey: .state), hintLevel: try c.decode(Int.self, forKey: .hintLevel), presence: try c.decode(String.self, forKey: .presence))
        case "confirmTranscript": self = .confirmTranscript(id: id, targetEventId: try c.decode(String.self, forKey: .targetEventId), text: try c.decode(String.self, forKey: .text))
        case "softLanding": self = .softLanding(id: id, message: try c.decode(String.self, forKey: .message), options: try c.decode([String].self, forKey: .options))
        case "notice": self = .notice(id: id, text: try c.decode(String.self, forKey: .text))
        case let other: throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "未知出站消息：\(other)")
        }
    }
}

enum ServerFrame: Equatable {
    case ack(id: String, clientSeq: Int, serverReceivedAt: Int64)
    case nack(reason: String, expectedSeq: Int)
    case outbound(ChildOutbound)
    case error(reason: String, id: String?)
}

extension ServerFrame: Decodable {
    private enum Keys: String, CodingKey { case protocolVersion, type, id, clientSeq, serverReceivedAt, reason, expectedSeq, message }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let version = try c.decode(Int.self, forKey: .protocolVersion)
        guard version == SessionProtocol.version else {
            throw DecodingError.dataCorruptedError(forKey: .protocolVersion, in: c, debugDescription: "协议主版本不匹配：\(version)")
        }
        switch try c.decode(String.self, forKey: .type) {
        case "ack": self = .ack(id: try c.decode(String.self, forKey: .id), clientSeq: try c.decode(Int.self, forKey: .clientSeq), serverReceivedAt: try c.decode(Int64.self, forKey: .serverReceivedAt))
        case "nack": self = .nack(reason: try c.decode(String.self, forKey: .reason), expectedSeq: try c.decode(Int.self, forKey: .expectedSeq))
        case "outbound": self = .outbound(try c.decode(ChildOutbound.self, forKey: .message))
        case "error": self = .error(reason: try c.decode(String.self, forKey: .reason), id: try c.decodeIfPresent(String.self, forKey: .id))
        case let other: throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "未知帧类型：\(other)")
        }
    }
}
