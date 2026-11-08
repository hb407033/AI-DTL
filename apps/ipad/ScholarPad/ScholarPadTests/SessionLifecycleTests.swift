import XCTest
@testable import ScholarPad

@MainActor
final class SessionLifecycleTests: XCTestCase {
    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<50 { if predicate() { return }; try await Task.sleep(for: .milliseconds(10)) }
        XCTFail("条件未满足")
    }

    func testIdleNinetySecondsCloses() async throws {
        var now = Date(timeIntervalSince1970: 10_000)
        let session = FakeRealtimeSession()
        let lifecycle = SessionLifecycle(makeSession: { session }, instructions: { "要点" }, clock: { now })
        lifecycle.speechStarted()
        try await eventually { session.prewarmed == ["要点"] }
        now = now.addingTimeInterval(89)
        lifecycle.evaluate()
        XCTAssertTrue(session.closedReasons.isEmpty)
        now = now.addingTimeInterval(1)
        lifecycle.evaluate()
        XCTAssertEqual(session.closedReasons, ["closed"])
    }

    func testSpeechStartReopensAndPrewarms() async throws {
        var now = Date(timeIntervalSince1970: 10_000)
        var made: [FakeRealtimeSession] = []
        let lifecycle = SessionLifecycle(makeSession: { let s = FakeRealtimeSession(); made.append(s); return s }, instructions: { "要点" }, clock: { now })
        lifecycle.speechStarted()
        try await eventually { made.count == 1 && made[0].prewarmed == ["要点"] }
        now = now.addingTimeInterval(90)
        lifecycle.evaluate()
        lifecycle.speechStarted()
        try await eventually { made.count == 2 && made[1].prewarmed == ["要点"] }
        XCTAssertTrue(lifecycle.current === made[1])
    }

    func testRotationAfterEightTurnsCreatesNewSessionBeforeNextSpeech() async throws {
        var made: [FakeRealtimeSession] = []
        let lifecycle = SessionLifecycle(makeSession: { let s = FakeRealtimeSession(); made.append(s); return s }, instructions: { "要点" })
        lifecycle.speechStarted()
        try await eventually { made.count == 1 }
        for _ in 0..<8 { lifecycle.turnCompleted() }
        try await eventually { made.count == 2 }
        XCTAssertTrue(lifecycle.current === made[0])
        XCTAssertTrue(made[0].closedReasons.isEmpty)
        lifecycle.speechStarted()
        XCTAssertTrue(lifecycle.current === made[1])
        XCTAssertEqual(made[0].closedReasons, ["closed"])
    }

    func testNoCloseOrRotateWhileTurnInFlight() async throws {
        var now = Date(timeIntervalSince1970: 10_000)
        var made: [FakeRealtimeSession] = []
        let lifecycle = SessionLifecycle(makeSession: { let s = FakeRealtimeSession(); made.append(s); return s }, instructions: { "要点" }, clock: { now })
        lifecycle.speechStarted()
        try await eventually { made.count == 1 }
        lifecycle.turnInFlight(true)
        for _ in 0..<8 { lifecycle.turnCompleted() }
        now = now.addingTimeInterval(120)
        lifecycle.evaluate()
        lifecycle.speechStarted()
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(made.count, 1)
        XCTAssertTrue(made[0].closedReasons.isEmpty)
        XCTAssertTrue(lifecycle.current === made[0])
    }

    func testInstructionsRebuiltWithLatestHighlightsOnRotation() async throws {
        var text = "第一版要点"
        var made: [FakeRealtimeSession] = []
        let lifecycle = SessionLifecycle(makeSession: { let s = FakeRealtimeSession(); made.append(s); return s }, instructions: { text })
        lifecycle.speechStarted()
        try await eventually { made.first?.prewarmed == ["第一版要点"] }
        text = "第二版含新要点"
        for _ in 0..<8 { lifecycle.turnCompleted() }
        try await eventually { made.count == 2 && made[1].prewarmed == ["第二版含新要点"] }
    }
}
