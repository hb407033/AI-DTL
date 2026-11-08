import Foundation

enum TurnKind: String, Codable, Equatable { case help, question, idea, selfTalk, finish }

struct TurnHeader: Equatable { let transcript: String; let kind: TurnKind }

/// 增量拼头部 JSON。围栏和后面多出来的字不进入转写，也不拿去播放。
struct TurnHeaderParser {
    private var buffer = ""
    private(set) var trailing = ""
    private var finished = false

    mutating func feed(_ delta: String) -> TurnHeader? {
        if finished { trailing += delta; return nil }
        buffer += delta
        let stripped = Self.stripFence(buffer)
        guard let match = Self.firstObject(in: stripped) else { return nil }
        finished = true
        trailing = match.rest
        buffer = ""
        guard let data = match.object.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let transcript = json["transcript"] as? String,
              let raw = json["kind"] as? String,
              let kind = TurnKind(rawValue: raw) else { return nil }
        return TurnHeader(transcript: transcript, kind: kind)
    }

    private static func stripFence(_ text: String) -> String {
        var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("```") {
            value.removeFirst(3)
            if value.lowercased().hasPrefix("json") { value.removeFirst(4) }
            value = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if let end = value.range(of: "```") { value.removeSubrange(end) }
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func firstObject(in text: String) -> (object: String, rest: String)? {
        guard let start = text.firstIndex(of: "{") else { return nil }
        var depth = 0
        var inString = false
        var escaped = false
        var index = start
        while index < text.endIndex {
            let character = text[index]
            if inString {
                if escaped { escaped = false }
                else if character == "\\" { escaped = true }
                else if character == "\"" { inString = false }
            } else if character == "\"" { inString = true }
            else if character == "{" { depth += 1 }
            else if character == "}" {
                depth -= 1
                if depth == 0 {
                    let next = text.index(after: index)
                    return (String(text[start..<next]), String(text[next...]))
                }
            }
            index = text.index(after: index)
        }
        return nil
    }
}
