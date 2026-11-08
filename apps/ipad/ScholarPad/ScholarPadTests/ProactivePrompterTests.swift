import XCTest
@testable import ScholarPad

@MainActor
final class ProactivePrompterTests: XCTestCase {
    func testIdle40sWithNewInkPrompts() {
        var now = Date(timeIntervalSince1970: 0)
        let prompter = ProactivePrompter(clock: { now })
        var reasons: [ProactiveReason] = []
        prompter.onPrompt = { reasons.append($0) }
        prompter.inkChanged()
        now = now.addingTimeInterval(39)
        prompter.tick()
        XCTAssertTrue(reasons.isEmpty)
        now = now.addingTimeInterval(1)
        prompter.tick()
        XCTAssertEqual(reasons, [.idleWithNewInk])
    }

    func testIdleWithoutInkDoesNotPrompt() {
        var now = Date(timeIntervalSince1970: 0)
        let prompter = ProactivePrompter(clock: { now })
        var reasons: [ProactiveReason] = []
        prompter.onPrompt = { reasons.append($0) }
        now = now.addingTimeInterval(40)
        prompter.tick()
        XCTAssertTrue(reasons.isEmpty)
    }

    func testMinIntervalTwoMinutes() {
        var now = Date(timeIntervalSince1970: 0)
        let prompter = ProactivePrompter(clock: { now })
        var reasons: [ProactiveReason] = []
        prompter.onPrompt = { reasons.append($0) }
        prompter.inkChanged()
        now = now.addingTimeInterval(40)
        prompter.tick()
        prompter.inkChanged()
        now = now.addingTimeInterval(40)
        prompter.tick()
        XCTAssertEqual(reasons.count, 1)
        now = now.addingTimeInterval(80)
        prompter.tick()
        XCTAssertEqual(reasons.count, 2)
    }

    func testMaxThreePerProblemResetsOnProblemChange() {
        var now = Date(timeIntervalSince1970: 0)
        let prompter = ProactivePrompter(clock: { now })
        var reasons: [ProactiveReason] = []
        prompter.onPrompt = { reasons.append($0) }
        for index in 0..<4 {
            prompter.inkChanged()
            now = now.addingTimeInterval(index == 0 ? 40 : 120)
            prompter.tick()
        }
        XCTAssertEqual(reasons.count, 3)
        prompter.problemChanged()
        prompter.inkChanged()
        now = now.addingTimeInterval(40)
        prompter.tick()
        XCTAssertEqual(reasons.count, 4)
    }

    func testNewResultNumberPromptsOnce() {
        var now = Date(timeIntervalSince1970: 0)
        let prompter = ProactivePrompter(clock: { now })
        var reasons: [ProactiveReason] = []
        prompter.onPrompt = { reasons.append($0) }
        prompter.newResultNumberSeen("0.72")
        prompter.newResultNumberSeen("0.72")
        XCTAssertEqual(reasons, [.newResultNumber("0.72")])
    }
}
