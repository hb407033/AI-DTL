// 语音活动检测测试。检测器先用一段时间测噪声底，阈值 = max(绝对下限, 噪声底 × 倍率)；
// 越过阈值要持续 attack 毫秒才算开口，低于阈值持续 release 毫秒才算停口；时间按每帧实际时长累加，不按帧数。
import XCTest
@testable import ScholarPadProbe

final class VoiceActivityDetectorTests: XCTestCase {
    /// 100ms 校准、3 倍噪声底、绝对下限 0.01、attack 60ms、release 300ms
    private func makeDetector() -> VoiceActivityDetector {
        VoiceActivityDetector(config: .init(calibrationMs: 100, noiseRatio: 3, minThreshold: 0.01, attackMs: 60, releaseMs: 300))
    }

    /// 校准事件的阈值是 Float 乘法结果，按精度比较
    private func assertCalibrated(_ event: VoiceActivityDetector.Event?, threshold expected: Float,
                                  file: StaticString = #filePath, line: UInt = #line) {
        guard case .calibrated(let t)? = event else {
            return XCTFail("期望 calibrated，实际 \(String(describing: event))", file: file, line: line)
        }
        XCTAssertEqual(t, expected, accuracy: 1e-6, file: file, line: line)
    }

    /// 用 5 帧 × 20ms 的安静帧完成校准
    private func calibrate(_ d: inout VoiceActivityDetector, floor: Float = 0.005) -> VoiceActivityDetector.Event? {
        var last: VoiceActivityDetector.Event?
        for _ in 0..<5 { last = d.push(rms: floor, frameMs: 20) }
        return last
    }

    func testCalibrationEndsByAccumulatedTimeAndReportsThreshold() {
        var d = makeDetector()
        XCTAssertNil(d.push(rms: 0.005, frameMs: 20))
        XCTAssertNil(d.push(rms: 0.005, frameMs: 20))
        XCTAssertNil(d.push(rms: 0.005, frameMs: 20))
        XCTAssertNil(d.push(rms: 0.005, frameMs: 20))
        // 第 5 帧累计 100ms，校准结束；阈值 = max(0.01, 0.005×3) = 0.015
        assertCalibrated(d.push(rms: 0.005, frameMs: 20), threshold: 0.015)
    }

    func testCalibrationCountsFrameDurationNotFrameCount() {
        var d = makeDetector()
        XCTAssertNil(d.push(rms: 0.005, frameMs: 50))
        assertCalibrated(d.push(rms: 0.005, frameMs: 50), threshold: 0.015)
    }

    func testLoudFramesDuringCalibrationDoNotTrigger() {
        var d = makeDetector()
        XCTAssertNil(d.push(rms: 0.5, frameMs: 20))
        XCTAssertNil(d.push(rms: 0.5, frameMs: 20))
    }

    func testSpeechStartsOnlyAfterAttackDuration() {
        var d = makeDetector(); _ = calibrate(&d)
        XCTAssertNil(d.push(rms: 0.05, frameMs: 20))
        XCTAssertNil(d.push(rms: 0.05, frameMs: 20))
        XCTAssertEqual(d.push(rms: 0.05, frameMs: 20), .speechStarted(onsetTag: 0))   // 累计 60ms
        XCTAssertNil(d.push(rms: 0.05, frameMs: 20))                     // 已在说话，不重复报
    }

    func testQuietFrameBeforeAttackResetsAccumulation() {
        var d = makeDetector(); _ = calibrate(&d)
        _ = d.push(rms: 0.05, frameMs: 20)
        _ = d.push(rms: 0.05, frameMs: 20)
        XCTAssertNil(d.push(rms: 0.001, frameMs: 20))   // 归零
        XCTAssertNil(d.push(rms: 0.05, frameMs: 20))
        XCTAssertNil(d.push(rms: 0.05, frameMs: 20))
        XCTAssertEqual(d.push(rms: 0.05, frameMs: 20), .speechStarted(onsetTag: 0))
    }

    func testReleaseEmitsSpeechEndedThenReArms() {
        var d = makeDetector(); _ = calibrate(&d)
        _ = d.push(rms: 0.05, frameMs: 60)               // 一帧 60ms 直接开口
        XCTAssertNil(d.push(rms: 0.001, frameMs: 100))
        XCTAssertNil(d.push(rms: 0.001, frameMs: 100))
        XCTAssertEqual(d.push(rms: 0.001, frameMs: 100), .speechEnded)   // 累计 300ms 安静
        XCTAssertEqual(d.push(rms: 0.05, frameMs: 60), .speechStarted(onsetTag: 0))   // 重新可触发
    }

    func testThresholdScalesWithNoiseFloor() {
        // 噪声底 0.05 → 阈值 0.15；0.08 在固定阈值 0.05 下会误触发，这里不能
        var d = makeDetector()
        assertCalibrated(calibrate(&d, floor: 0.05), threshold: 0.15)
        for _ in 0..<10 { XCTAssertNil(d.push(rms: 0.08, frameMs: 20)) }
    }

    func testThresholdHasAbsoluteMinimum() {
        var d = makeDetector()
        assertCalibrated(calibrate(&d, floor: 0), threshold: 0.01)
    }
}

final class VoiceActivityDetectorOnsetTests: XCTestCase {
    /// 打断延迟要从"开口那一帧"算起：检测器记下 attack 窗口第一帧携带的时间标签（音频 hostTime）
    func testSpeechStartedCarriesTagOfFirstLoudFrame() {
        var d = VoiceActivityDetector(config: .init(calibrationMs: 40, noiseRatio: 3, minThreshold: 0.01, attackMs: 60, releaseMs: 300))
        _ = d.push(rms: 0.005, frameMs: 20, tag: 1)
        _ = d.push(rms: 0.005, frameMs: 20, tag: 2)      // 校准完成
        _ = d.push(rms: 0.05, frameMs: 20, tag: 100)     // 开口第一帧
        _ = d.push(rms: 0.05, frameMs: 20, tag: 101)
        let event = d.push(rms: 0.05, frameMs: 20, tag: 102)
        XCTAssertEqual(event, .speechStarted(onsetTag: 100))
    }

    func testQuietFrameResetsOnsetTag() {
        var d = VoiceActivityDetector(config: .init(calibrationMs: 40, noiseRatio: 3, minThreshold: 0.01, attackMs: 60, releaseMs: 300))
        _ = d.push(rms: 0.005, frameMs: 40, tag: 1)
        _ = d.push(rms: 0.05, frameMs: 20, tag: 100)
        _ = d.push(rms: 0.001, frameMs: 20, tag: 101)    // 中断，前面的开口作废
        _ = d.push(rms: 0.05, frameMs: 20, tag: 200)
        _ = d.push(rms: 0.05, frameMs: 20, tag: 201)
        XCTAssertEqual(d.push(rms: 0.05, frameMs: 20, tag: 202), .speechStarted(onsetTag: 200))
    }
}
