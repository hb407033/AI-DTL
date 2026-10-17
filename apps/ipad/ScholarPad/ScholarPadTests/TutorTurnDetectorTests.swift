import XCTest
@testable import ScholarPad

final class TutorTurnDetectorTests: XCTestCase {
    func testSilenceNeverProducesATurnAndBufferIsBounded() {
        var detector = TutorTurnDetector()
        for _ in 0..<3000 { XCTAssertNil(detector.append(chunk(0))) }
        XCTAssertLessThanOrEqual(detector.bufferedBytes, 16000)
    }
    func testSpeechIncludesPreRollAndWaitsForTwoSecondPause() {
        var detector = TutorTurnDetector()
        for _ in 0..<10 { XCTAssertNil(detector.append(chunk(0))) }
        for _ in 0..<8 { XCTAssertNil(detector.append(chunk(3000))) }
        // 默认 2 秒（64000 bytes = 20 帧）静音才结束；19 帧仍不结束。
        for _ in 0..<19 { XCTAssertNil(detector.append(chunk(0))) }
        let turn = detector.append(chunk(0))
        XCTAssertNotNil(turn)
        XCTAssertGreaterThan(turn?.count ?? 0, 8 * 3200)
        XCTAssertNil(detector.append(chunk(0)))
    }
    func testOnePointTwoSecondInternalPauseDoesNotCut() {
        var detector = TutorTurnDetector()
        for _ in 0..<8 { XCTAssertNil(detector.append(chunk(3000))) }
        // 1.2 秒（38400 bytes = 12 帧）思考停顿：不足 2 秒，不结束
        for _ in 0..<12 { XCTAssertNil(detector.append(chunk(0))) }
        // 继续说话，再 2 秒静音才结束
        for _ in 0..<8 { XCTAssertNil(detector.append(chunk(3000))) }
        for _ in 0..<19 { XCTAssertNil(detector.append(chunk(0))) }
        XCTAssertNotNil(detector.append(chunk(0)))
    }
    func testSilenceBytesInjectableAndPreservedAcrossReset() {
        var detector = TutorTurnDetector(silenceBytes: 38400) // 1.2 秒
        for _ in 0..<8 { XCTAssertNil(detector.append(chunk(3000))) }
        for _ in 0..<11 { XCTAssertNil(detector.append(chunk(0))) }
        XCTAssertNotNil(detector.append(chunk(0)))
        // reset 后配置保留：再次 1.2 秒结束
        for _ in 0..<8 { XCTAssertNil(detector.append(chunk(3000))) }
        for _ in 0..<11 { XCTAssertNil(detector.append(chunk(0))) }
        XCTAssertNotNil(detector.append(chunk(0)))
    }
    func testBriefClickIsNotSubmitted() {
        var detector = TutorTurnDetector()
        XCTAssertNil(detector.append(chunk(12000)))
        for _ in 0..<20 { XCTAssertNil(detector.append(chunk(0))) }
    }
    func testLongSpeechIsBounded() {
        var detector = TutorTurnDetector()
        var turn: Data?
        for _ in 0..<300 { if let result = detector.append(chunk(3000)) { turn = result; break } }
        XCTAssertNotNil(turn)
        XCTAssertLessThanOrEqual(turn?.count ?? Int.max, 960000)
    }
    private func chunk(_ value: Int16) -> Data {
        Array(repeating: value.littleEndian, count: 1600).withUnsafeBytes { Data($0) }
    }
}
