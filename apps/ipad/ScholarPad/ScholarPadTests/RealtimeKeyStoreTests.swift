import XCTest
@testable import ScholarPad

@MainActor
final class RealtimeKeyStoreTests: XCTestCase {
    override func setUp() {
        super.setUp()
        RealtimeKeyStore.storage = MemoryRealtimeSecretStore()
    }

    override func tearDown() {
        RealtimeKeyStore.clear()
        RealtimeKeyStore.storage = KeychainRealtimeSecretStore()
        RealtimeKeyStore.requester = nil
        RealtimeKeyStore.logger = { _ in }
        super.tearDown()
    }

    func testSaveLoadClearRoundTrip() throws {
        let url = try XCTUnwrap(URL(string: "wss://example.invalid/realtime"))
        let keychain = KeychainRealtimeSecretStore()
        do { try keychain.save(url: url, apiKey: "synthetic-realtime-key"); keychain.clear() }
        catch RealtimeKeyError.keychain(-34018) { /* 未签名测试进程没有钥匙串权限。下面仍验证存取接口。 */ }
        try RealtimeKeyStore.save(url: url, apiKey: "synthetic-realtime-key")
        let loaded = RealtimeKeyStore.load()
        XCTAssertEqual(loaded?.url, url)
        XCTAssertEqual(loaded?.apiKey, "synthetic-realtime-key")
        RealtimeKeyStore.clear()
        XCTAssertNil(RealtimeKeyStore.load())
    }

    func testFetchStoresKeyAndNeverLogsIt() async throws {
        let secret = "synthetic-realtime-key"
        let code = "246813"
        var logs: [String] = []
        RealtimeKeyStore.logger = { logs.append($0) }
        RealtimeKeyStore.requester = { host, received in
            XCTAssertEqual(host, "127.0.0.1")
            XCTAssertEqual(received, code)
            return (try XCTUnwrap(URL(string: "wss://example.invalid/realtime")), secret)
        }
        try await RealtimeKeyStore.fetch(host: "127.0.0.1", code: code)
        let loaded = RealtimeKeyStore.load()
        XCTAssertEqual(loaded?.apiKey, secret)
        XCTAssertFalse(logs.joined().contains(secret))
        XCTAssertFalse(logs.joined().contains(code))
    }
}
