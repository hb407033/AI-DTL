import Foundation
import JavaScriptCore

struct TeachingDecisionRecord: Codable, Equatable {
    var problemId: String
    var problemRevision: Int
    var turnId: String
    var responseId: String
    var child: String
    var focus: String
    var observation: String
    var evidenceIds: [String]
    var resolved: [String]
    var utterance: String
    var method: String
    var handoff: Bool
}

struct GateContext: Codable, Equatable {
    var record: WorkspaceRecord
    var turnId: String
    var responseId: String
    var permission: String
    var child: String
    var history: [TeachingDecisionRecord]
    var imageAttached: Bool
    var ocrNumbers: [String]
    var inkChanged: Bool = false
    var canvasJPEG: Data?
    // 照片和“有没有新笔迹”不进 JS。门禁只看 imageAttached。
    enum CodingKeys: String, CodingKey {
        case record, turnId, responseId, permission, child, history, imageAttached, ocrNumbers
    }
}

struct GateVerdict: Equatable {
    let ok: Bool
    let reason: String?
    let rewrite: String?
    let draftJSON: String?
}

enum TeachingGatesError: Error { case scriptMissing, exception(String), invalidResult }

@MainActor
final class TeachingGates {
    private let context = JSContext()!
    private var lastException: String?

    init(script: String? = nil) throws {
        let source: String
        if let script { source = script }
        else {
            guard let url = Bundle.main.url(forResource: "teaching-gates", withExtension: "js"),
                  let loaded = try? String(contentsOf: url, encoding: .utf8) else { throw TeachingGatesError.scriptMissing }
            source = loaded
        }
        context.exceptionHandler = { [weak self] _, value in self?.lastException = value?.toString() }
        // JavaScriptCore 没有浏览器的 btoa。慢路径只有附图时才用到，照片字节仍不进门禁。
        context.evaluateScript("""
        if (typeof btoa !== "function") {
          var btoa = function(input) {
            var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
            var out = "";
            for (var i = 0; i < input.length; i += 3) {
              var a = input.charCodeAt(i);
              var b = i + 1 < input.length ? input.charCodeAt(i + 1) : NaN;
              var c = i + 2 < input.length ? input.charCodeAt(i + 2) : NaN;
              var n = (a << 16) | ((isNaN(b) ? 0 : b) << 8) | (isNaN(c) ? 0 : c);
              out += chars.charAt((n >> 18) & 63) + chars.charAt((n >> 12) & 63)
                + (isNaN(b) ? "=" : chars.charAt((n >> 6) & 63)) + (isNaN(c) ? "=" : chars.charAt(n & 63));
            }
            return out;
          };
        }
        """)
        context.evaluateScript(source)
        if let lastException { throw TeachingGatesError.exception(lastException) }
    }

    func check(utterance: String, context gate: GateContext) throws -> GateVerdict {
        try verdict(call("checkUtterance", [utterance, try json(gate)]))
    }

    func checkDraft(_ draft: String, context gate: GateContext) throws -> GateVerdict {
        try verdict(call("checkDraft", [draft, try json(gate)]))
    }

    func matchesSpeech(_ actual: String, _ expected: String) -> Bool {
        (try? call("matchesSpeech", [actual, expected]))?.toBool() ?? false
    }

    func realtimeInstructions(_ gate: GateContext) -> String {
        (try? call("buildRealtimeInstructions", [json(gate)]))?.toString() ?? ""
    }

    func headerInstructions() -> String { (try? call("headerInstructions", []))?.toString() ?? "" }
    func replyInstructions(kind: TurnKind) -> String { (try? call("replyInstructions", [kind.rawValue]))?.toString() ?? "" }

    /// JS 的 Promise 回调留在这个上下文里，等 Swift 挂起结束后再在主线程 resolve。
    func decideSlow(context gate: GateContext, rejectedReason: String,
                    requestText: @escaping (String, Data?) async throws -> String,
                    speak: @escaping (String) async throws -> (ok: Bool, spoken: String)) async throws -> String {
        let hooks = JSValue(newObjectIn: context)!
        let requestBlock: @convention(block) (String, String?) -> JSValue = { [context] instructions, imageBase64 in
            JSValue(newPromiseIn: context) { resolve, reject in
                let keptResolve = resolve
                let keptReject = reject
                Task { @MainActor in
                    do {
                        let image = imageBase64.flatMap { Data(base64Encoded: $0) }
                        let text = try await requestText(instructions, image)
                        keptResolve?.call(withArguments: [text])
                    } catch {
                        keptReject?.call(withArguments: ["requestTextFailed"])
                    }
                }
            }
        }
        let speakBlock: @convention(block) (String) -> JSValue = { [context] text in
            JSValue(newPromiseIn: context) { resolve, reject in
                let keptResolve = resolve
                let keptReject = reject
                Task { @MainActor in
                    do {
                        let spoken = try await speak(text)
                        let object = JSValue(newObjectIn: context)!
                        object.setObject(spoken.ok, forKeyedSubscript: "ok" as NSString)
                        object.setObject(spoken.spoken, forKeyedSubscript: "spoken" as NSString)
                        keptResolve?.call(withArguments: [object])
                    } catch {
                        keptReject?.call(withArguments: ["speakFailed"])
                    }
                }
            }
        }
        hooks.setObject(requestBlock, forKeyedSubscript: "requestText" as NSString)
        hooks.setObject(speakBlock, forKeyedSubscript: "speak" as NSString)
        guard let promise = try call("decideSlow", [try json(gate), rejectedReason, hooks]) else { throw TeachingGatesError.invalidResult }
        return try await withCheckedThrowingContinuation { continuation in
            let success: @convention(block) (JSValue) -> Void = { value in
                continuation.resume(returning: value.toString())
            }
            let failure: @convention(block) (JSValue) -> Void = { value in
                continuation.resume(throwing: TeachingGatesError.exception(value.toString()))
            }
            promise.invokeMethod("then", withArguments: [success, failure])
        }
    }

    private func call(_ name: String, _ arguments: [Any]) throws -> JSValue? {
        lastException = nil
        guard let function = context.objectForKeyedSubscript("TeachingGates")?.objectForKeyedSubscript(name) else {
            throw TeachingGatesError.exception("missing \(name)")
        }
        let value = function.call(withArguments: arguments)
        if let lastException { throw TeachingGatesError.exception(lastException) }
        return value
    }

    private func json(_ gate: GateContext) throws -> String {
        String(decoding: try JSONEncoder().encode(gate), as: UTF8.self)
    }

    private func verdict(_ value: JSValue?) throws -> GateVerdict {
        guard let text = value?.toString(), let data = text.data(using: .utf8),
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw TeachingGatesError.invalidResult }
        let draft = json["draft"].map { item -> String in
            (try? String(decoding: JSONSerialization.data(withJSONObject: item), as: UTF8.self)) ?? ""
        }
        return GateVerdict(ok: json["ok"] as? Bool ?? false, reason: json["reason"] as? String,
                           rewrite: json["rewrite"] as? String, draftJSON: draft)
    }
}
