import Foundation
import Security

/// 实时模型地址和密钥只放钥匙串。日志和界面都不出现密钥，口令用过即从输入框清掉。
@MainActor
protocol RealtimeSecretStoring: AnyObject {
    func load() -> (url: URL, apiKey: String)?
    func save(url: URL, apiKey: String) throws
    func clear()
}

/// 未签名的单元测试进程没有钥匙串权限（-34018）。正式 App 仍走钥匙串。
@MainActor
final class MemoryRealtimeSecretStore: RealtimeSecretStoring {
    private var value: (url: URL, apiKey: String)?
    func load() -> (url: URL, apiKey: String)? { value }
    func save(url: URL, apiKey: String) { value = (url, apiKey) }
    func clear() { value = nil }
}

@MainActor
final class KeychainRealtimeSecretStore: RealtimeSecretStoring {
    static let service = "com.houbin.aischolar.pad.realtime"
    func load() -> (url: URL, apiKey: String)? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let raw = json["url"], let url = URL(string: raw), let apiKey = json["apiKey"], !apiKey.isEmpty else { return nil }
        return (url, apiKey)
    }
    func save(url: URL, apiKey: String) throws {
        clear()
        let payload = try JSONSerialization.data(withJSONObject: ["url": url.absoluteString, "apiKey": apiKey])
        var query = baseQuery()
        query[kSecValueData as String] = payload
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw RealtimeKeyError.keychain(status) }
    }
    func clear() { SecItemDelete(baseQuery() as CFDictionary) }
    private func baseQuery() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: Self.service,
         kSecAttrAccount as String: "default"]
    }
}

@MainActor
enum RealtimeKeyStore {
    static let service = KeychainRealtimeSecretStore.service
    static var storage: RealtimeSecretStoring = KeychainRealtimeSecretStore()
    static var logger: (String) -> Void = { _ in }
    static var requester: ((String, String) async throws -> (url: URL, apiKey: String))?

    static func load() -> (url: URL, apiKey: String)? { storage.load() }
    static func save(url: URL, apiKey: String) throws { try storage.save(url: url, apiKey: apiKey) }
    static func clear() { storage.clear() }

    static func fetch(host: String, code: String) async throws {
        logger("领取实时连接")
        let received: (url: URL, apiKey: String)
        if let requester { received = try await requester(host, code) }
        else { received = try await requestFromHost(host: host, code: code) }
        try save(url: received.url, apiKey: received.apiKey)
    }

    private static func requestFromHost(host: String, code: String) async throws -> (url: URL, apiKey: String) {
        guard !host.contains("/"), !host.contains("@"),
              let endpoint = URL(string: "http://\(host):8791/workspace/credentials/realtime") else { throw RealtimeKeyError.unavailable }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["code": code])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: String],
              let raw = json["url"], let url = URL(string: raw), let apiKey = json["apiKey"], !apiKey.isEmpty else { throw RealtimeKeyError.unavailable }
        return (url, apiKey)
    }
}

enum RealtimeKeyError: Error { case keychain(OSStatus), unavailable }
