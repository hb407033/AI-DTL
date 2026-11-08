import Foundation

enum ThinkingTextError: Error {
    case insecureEndpoint
    case invalidInstructions
    case imageSize
    case httpFailure
    case incomplete
    case timedOut
    case invalidResponse
    case provider
}

/// 与主机 `requestThinkingText` 同一条 compatible-mode 协议。密钥只放在请求头里，错误信息不带密钥、正文或思维链。
enum ThinkingTextClient {
    static let model = "qwen3.8-omni-flash"
    private static let maxTokens = 4096
    private static let textLimit = 16000

    static func request(instructions: String, image: Data?, credentialURL: URL, apiKey: String,
                        timeout: Duration = .seconds(45),
                        transport: @escaping @MainActor (URLRequest) async throws -> (Data, HTTPURLResponse)) async throws -> String {
        if instructions.isEmpty || instructions.count > textLimit { throw ThinkingTextError.invalidInstructions }
        if let image, image.isEmpty || image.count > 180_000 { throw ThinkingTextError.imageSize }
        guard let url = completionsURL(credentialURL) else { throw ThinkingTextError.insecureEndpoint }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body(instructions: instructions, image: image))
        request.timeoutInterval = seconds(timeout)
        let (data, response) = try await race(timeout: timeout) { try await transport(request) }
        guard (200..<300).contains(response.statusCode) else { throw ThinkingTextError.httpFailure }
        return try parseSSE(data)
    }

    /// 只有 wss 地址才换成同一主机的 https。明文 ws/http 直接拒绝，避免把密钥发到不安全的地址。
    static func completionsURL(_ realtime: URL) -> URL? {
        guard realtime.scheme == "wss", realtime.user == nil, realtime.password == nil,
              let host = realtime.host, !host.isEmpty else { return nil }
        var parts = URLComponents()
        parts.scheme = "https"
        parts.host = host
        parts.port = realtime.port
        parts.path = "/compatible-mode/v1/chat/completions"
        return parts.url
    }

    private static func body(instructions: String, image: Data?) -> [String: Any] {
        let content: Any
        if let image {
            let mime = image.count >= 2 && image[0] == 0xFF && image[1] == 0xD8 ? "image/jpeg" : "image/png"
            content = [["type": "text", "text": instructions],
                       ["type": "image_url", "image_url": ["url": "data:\(mime);base64,\(image.base64EncodedString())"]]]
        } else {
            content = [["type": "text", "text": instructions]]
        }
        return ["model": model, "reasoning_effort": "medium", "max_tokens": maxTokens,
                "modalities": ["text"], "stream": true, "stream_options": ["include_usage": true],
                "messages": [["role": "user", "content": content]]]
    }

    private static func race(timeout: Duration, work: @escaping @MainActor () async throws -> (Data, HTTPURLResponse)) async throws -> (Data, HTTPURLResponse) {
        let worker = Task { @MainActor in try await work() }
        let timer = Task {
            try await Task.sleep(for: timeout)
            worker.cancel()
        }
        return try await withTaskCancellationHandler {
            do {
                let result = try await worker.value
                timer.cancel()
                return result
            } catch {
                timer.cancel()
                if error is CancellationError, !Task.isCancelled { throw ThinkingTextError.timedOut }
                throw error
            }
        } onCancel: {
            worker.cancel()
            timer.cancel()
        }
    }

    /// 只保留正文。思维链内容不进入结果。
    static func parseSSE(_ data: Data) throws -> String {
        var pending = String(decoding: data, as: UTF8.self)
        var text = ""
        var done = false
        var finish: String?
        while let range = pending.range(of: "\r\n\r\n") ?? pending.range(of: "\n\n") {
            let frame = String(pending[..<range.lowerBound])
            pending = String(pending[range.upperBound...])
            let payload = frame.split(whereSeparator: \.isNewline).filter { $0.hasPrefix("data:") }.map { line -> String in
                var rest = line.dropFirst(5)
                if rest.first == " " { rest = rest.dropFirst() }
                return String(rest)
            }.joined(separator: "\n")
            if payload.isEmpty { continue }
            if payload == "[DONE]" { done = true; continue }
            guard let encoded = payload.data(using: .utf8),
                  let event = try JSONSerialization.jsonObject(with: encoded) as? [String: Any] else { throw ThinkingTextError.incomplete }
            if event["error"] != nil { throw ThinkingTextError.provider }
            for choice in event["choices"] as? [[String: Any]] ?? [] {
                if let delta = choice["delta"] as? [String: Any], let content = delta["content"] as? String { text += content }
                if let reason = choice["finish_reason"] as? String { finish = reason }
            }
            if text.count > textLimit { throw ThinkingTextError.provider }
        }
        if !done || !pending.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || finish != "stop" {
            throw ThinkingTextError.incomplete
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func seconds(_ timeout: Duration) -> TimeInterval {
        let parts = timeout.components
        return TimeInterval(parts.seconds) + TimeInterval(parts.attoseconds) / 1_000_000_000_000_000_000
    }
}
