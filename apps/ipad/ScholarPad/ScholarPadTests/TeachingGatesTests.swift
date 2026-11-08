import XCTest
@testable import ScholarPad

@MainActor
final class TeachingGatesTests: XCTestCase {
    func testVerdictsMatchSharedSamples() throws {
        let gates = try RealtimeTestSupport.gates()
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "teaching-gates-samples", withExtension: "json"))
        let samples = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
        XCTAssertEqual(samples.count, 30)
        for sample in samples {
            let name = sample["name"] as? String ?? ""
            let draft = try JSONSerialization.data(withJSONObject: try XCTUnwrap(sample["draft"]))
            let contextData = try JSONSerialization.data(withJSONObject: try XCTUnwrap(sample["context"]))
            let context = try JSONDecoder().decode(GateContext.self, from: contextData)
            let verdict = try gates.checkDraft(String(decoding: draft, as: UTF8.self), context: context)
            let expect = try XCTUnwrap(sample["expect"] as? [String: Any])
            XCTAssertEqual(verdict.ok, expect["ok"] as? Bool, name)
            if let reason = expect["reason"] as? String { XCTAssertEqual(verdict.reason, reason, name) }
        }
    }

    func testMatchesSpeechTreatsChineseDigitsEqual() throws {
        let gates = try RealtimeTestSupport.gates()
        XCTAssertTrue(gates.matchesSpeech("七点七", "7.7"))
    }
}
