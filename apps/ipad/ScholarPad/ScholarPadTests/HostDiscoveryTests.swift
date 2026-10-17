import XCTest
@testable import ScholarPad

final class HostDiscoveryTests: XCTestCase {
    @MainActor func testLiveBonjourResolvesVerifiedHost() async throws {
        guard ProcessInfo.processInfo.environment["AI_DTL_DISCOVERY_LIVE"] == "1" else { throw XCTSkip("需要本地 Bonjour 学习主机") }
        let discovery = HostDiscovery()
        discovery.start()
        defer { discovery.stop() }
        for _ in 0..<40 {
            if !discovery.candidates.isEmpty { break }
            try await Task.sleep(for: .milliseconds(500))
        }
        XCTAssertFalse(discovery.candidates.isEmpty, discovery.status)
        if let candidate = discovery.candidates.first {
            let verified = await LearningHostHealth.probe(candidate.address)
            XCTAssertEqual(verified, candidate.id)
        }
    }
    func testOnlyVerifiedCompatibleHostAccepted() throws {
        let good = Data(#"{"status":"ok","mode":"learning-tutor","discoveryVersion":1,"hostId":"a102ad98-fb7a-4aee-90d8-70c14359d427"}"#.utf8)
        XCTAssertNotNil(try JSONDecoder().decode(LearningHostHealth.self, from: good).verifiedID)
        let wrong = Data(#"{"status":"ok","mode":"other","discoveryVersion":1,"hostId":"a102ad98-fb7a-4aee-90d8-70c14359d427"}"#.utf8)
        XCTAssertNil(try JSONDecoder().decode(LearningHostHealth.self, from: wrong).verifiedID)
    }
}
