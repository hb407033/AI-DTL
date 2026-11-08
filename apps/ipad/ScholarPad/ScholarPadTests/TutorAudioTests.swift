import XCTest
import PencilKit
import AVFoundation
@testable import ScholarPad

final class TutorAudioTests: XCTestCase {
    @MainActor
    func testWorkspaceMicrophoneRemainsOpenDuringPlaybackAndInterrupt() async throws {
        let audio = TutorAudioIO(); defer { audio.stop() }
        await audio.listen()
        XCTAssertTrue(audio.recording)
        audio.beginResponse()
        XCTAssertTrue(audio.recording, "老师开口时仍需接住孩子的插话")
        try audio.play(Data(repeating: 0, count: 9600))
        audio.stopPlayback()
        XCTAssertTrue(audio.recording, "停声不停止麦克风")
        audio.completeResponse()
        audio.stop()
        XCTAssertFalse(audio.recording)
    }
    @MainActor
    func testGeneratedOmniRepliesPlayOnDeviceAcrossThreeTurns() async throws {
        guard let base = ProcessInfo.processInfo.environment["AI_DTL_TEST_AUDIO_URL"] else {
            throw XCTSkip("需要合成语音真实模型返回的 PCM 临时服务地址")
        }
        let client = SimpleTutorClient()
        defer { client.stop() }
        client.connected = true
        for turn in 2...4 {
            let url = try XCTUnwrap(URL(string: "\(base)/\(turn)"))
            let (pcm, response) = try await URLSession.shared.data(from: url)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            XCTAssertGreaterThan(pcm.count, 4800)
            XCTAssertEqual(pcm.count % 2, 0)
            XCTAssertTrue(pcm.contains { $0 != 0 }, "必须是真实非静音模型回答")
            client.ready = false
            for offset in stride(from: 0, to: pcm.count, by: 4800) {
                client.receiveAudio(pcm.subdata(in: offset..<min(offset + 4800, pcm.count)))
            }
            client.completeResponse()
            XCTAssertFalse(client.ready, "网络完成不能抢在扬声器播放结束之前置 ready")
            let deadline = Date().addingTimeInterval(Double(pcm.count) / 48000 + 5)
            while !client.ready && Date() < deadline {
                try await Task.sleep(for: .milliseconds(100))
            }
            XCTAssertTrue(client.ready, client.status)
            XCTAssertTrue(client.connected)
            XCTAssertFalse(client.status.contains("声音播放失败"), client.status)
            XCTAssertFalse(AVAudioSession.sharedInstance().currentRoute.outputs.isEmpty)
            print("Omni 合成输入真实返回：turn=\(turn) bytes=\(pcm.count) 播放排空，连接保留")
        }
        client.stop()
        client.completeResponse()
        XCTAssertFalse(client.ready, "停止后迟到 done 不能恢复录音或会话")
    }

    @MainActor
    func testLateResponseAfterStopCannotRestoreReady() {
        let client = SimpleTutorClient()
        client.connected = true
        client.stop()
        client.completeResponse()
        XCTAssertFalse(client.ready)
        XCTAssertFalse(client.recording)
        XCTAssertEqual(client.status, "已停止，画布保留。")
    }

    @MainActor
    func testTenAutomaticPlaybackToCaptureCyclesAndStopDuringRearm() async throws {
        let client = SimpleTutorClient()
        defer { client.stop() }
        client.connected = true; client.ready = true
        client.startContinuous { PKDrawing() }
        try await Task.sleep(for: .milliseconds(700))
        for _ in 0..<10 {
            XCTAssertTrue(client.recording, client.status)
            // 无云端的音频生命周期测试：结束空录音，再注入短静音回答。
            client.finish()
            client.ready = false
            client.receiveAudio(Data(repeating: 0, count: 9600))
            client.completeResponse()
            try await Task.sleep(for: .milliseconds(900))
            XCTAssertTrue(client.recording, client.status)
            XCTAssertTrue(client.connected)
        }
        client.finish()
        client.completeResponse()
        client.stop() // 正好处于 400ms 重开麦窗口。
        try await Task.sleep(for: .milliseconds(700))
        XCTAssertFalse(client.recording)
        XCTAssertFalse(client.ready)
    }
    @MainActor
    func testContinuousCaptureCanRestartAndStopWithoutRearming() async throws {
        let client = SimpleTutorClient()
        defer { client.stop() }
        for _ in 0..<3 {
            client.connected = true; client.ready = true
            client.startContinuous { PKDrawing() }
            try await Task.sleep(for: .milliseconds(600))
            XCTAssertTrue(client.recording, client.status)
            XCTAssertTrue(client.continuous)
            client.stop()
            try await Task.sleep(for: .milliseconds(500))
            XCTAssertFalse(client.recording)
            XCTAssertFalse(client.continuous)
        }
    }
    @MainActor
    func testResponseDoneWaitsForSpeakerBeforeReady() async throws {
        let client = SimpleTutorClient()
        defer { client.stop() }
        client.connected = true
        client.receiveAudio(Data(repeating: 0, count: 48000))
        client.completeResponse()
        XCTAssertFalse(client.ready, "网络生成完成不代表扬声器播完")
        try await Task.sleep(for: .milliseconds(1500))
        XCTAssertTrue(client.ready)
    }
    @MainActor
    func testRealPlaybackEngineCanRestartAcrossThreeTurns() async throws {
        let client = SimpleTutorClient()
        defer { client.stop() }
        // 真机使用实际 AVAudioEngine 和扬声器路由；静音 PCM 不等于听感验收。
        for _ in 0..<3 {
            client.connected = true
            client.receiveAudio(Data(repeating: 0, count: 9600))
            try await Task.sleep(for: .milliseconds(250))
            XCTAssertTrue(client.connected)
            XCTAssertFalse(client.status.contains("声音播放失败"), client.status)
            client.stop()
        }
    }
    @MainActor
    func testPlaybackFailureDoesNotDisconnectConversation() {
        let client = SimpleTutorClient(audioPlayback: { _ in throw NSError(domain: "test.audio", code: 42) })
        client.connected = true
        client.receiveAudio(Data([0, 0]))
        XCTAssertTrue(client.connected)
        XCTAssertTrue(client.status.contains("42"))
    }
}
