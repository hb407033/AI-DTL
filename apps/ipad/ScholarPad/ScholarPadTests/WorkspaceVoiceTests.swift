import XCTest
import PencilKit
import SwiftUI
import AVFoundation
@testable import ScholarPad

@MainActor
final class WorkspaceVoiceTests: XCTestCase {
    func testProductionCanvasUsesPencilAndPreservesPressureThroughRestore() async throws {
        let view = ChildCanvasView(clearToken: 0, onEvents: { _ in })
        let host = UIHostingController(rootView: view)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 800, height: 500))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { window.isHidden = true }
        host.view.layoutIfNeeded()
        func find(_ view: UIView) -> PKCanvasView? {
            if let canvas = view as? PKCanvasView { return canvas }
            return view.subviews.compactMap { find($0) }.first
        }
        for _ in 0..<100 { if find(host.view) != nil { break }; try await Task.sleep(for: .milliseconds(10)) }
        let canvas = try XCTUnwrap(find(host.view))
        #if !targetEnvironment(simulator)
        XCTAssertEqual(canvas.drawingPolicy, .pencilOnly)
        #endif
        XCTAssertEqual(canvas.overrideUserInterfaceStyle, .light)
        let points = [0.3, 0.9].enumerated().map { i, force in
            PKStrokePoint(location: CGPoint(x: 20 + i * 40, y: 30), timeOffset: Double(i) * 0.1,
                size: CGSize(width: 4, height: 4), opacity: 1, force: force, azimuth: 0.2, altitude: 1)
        }
        let drawing = PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date()))])
        let restored = try PKDrawing(data: drawing.dataRepresentation())
        XCTAssertEqual(restored.strokes.count, 1)
        XCTAssertEqual(restored.strokes[0].path[0].force, 0.3, accuracy: 0.001)
        XCTAssertEqual(restored.strokes[0].path[1].force, 0.9, accuracy: 0.001)
    }

    func testPhysicalMicrophoneReceivesAcousticSpeech() async throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("声学回路需要真实 iPad 麦克风")
        #else
        guard ProcessInfo.processInfo.environment["AI_DTL_ACOUSTIC_TEST"] == "1" else {
            throw XCTSkip("仅在测试执行者准备好外放合成语音时启动")
        }
        let audio = TutorAudioIO()
        defer { audio.stop() }
        var captured: Data?
        audio.onTurn = { captured = $0 }
        var speaker: AVAudioPlayer?
        if let base = ProcessInfo.processInfo.environment["AI_DTL_TEST_AUDIO_URL"], let url = URL(string: base + "/0") {
            let (pcm, response) = try await URLSession.shared.data(from: url)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            // WAV 容器只交给真实扬声器播放，不直接喂分段器或 onTurn。
            var wav = Data("RIFF".utf8)
            func append32(_ value: UInt32) { var little = value.littleEndian; withUnsafeBytes(of: &little) { wav.append(contentsOf: $0) } }
            func append16(_ value: UInt16) { var little = value.littleEndian; withUnsafeBytes(of: &little) { wav.append(contentsOf: $0) } }
            append32(UInt32(pcm.count + 36)); wav.append(Data("WAVEfmt ".utf8)); append32(16)
            append16(1); append16(1); append32(16000); append32(32000); append16(2); append16(16)
            wav.append(Data("data".utf8)); append32(UInt32(pcm.count)); wav.append(pcm)
            speaker = try AVAudioPlayer(data: wav)
        }
        await audio.listen()
        XCTAssertTrue(audio.recording)
        print("AI_DTL_ACOUSTIC_READY volume=\(AVAudioSession.sharedInstance().outputVolume)")
        if let speaker { XCTAssertTrue(speaker.play()) }
        defer { speaker?.stop() }
        for _ in 0..<200 {
            if captured != nil { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        print("AI_DTL_ACOUSTIC_INPUT bytes=\(audio.capturedPCMBytes) rms=\(audio.peakInputRMS) route=\(AVAudioSession.sharedInstance().currentRoute.inputs.map { $0.portType.rawValue })")
        let pcm = try XCTUnwrap(captured, "20秒内未收到外放测试短句，不能把音频注入当作麦克风声学验收")
        XCTAssertGreaterThan(pcm.count, 4000)
        XCTAssertFalse(audio.recording)
        #endif
    }
    func testRealCaptureCanStartAndStopThreeTimes() async throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("麦克风生命周期使用真机")
        #else
        let audio = TutorAudioIO()
        defer { audio.stop() }
        for _ in 0..<3 {
            await audio.listen()
            XCTAssertTrue(audio.recording)
            try await Task.sleep(for: .milliseconds(100))
            audio.stop()
            XCTAssertFalse(audio.recording)
        }
        #endif
    }
    func testPlaybackCompletionAfterStopCannotRestartRecording() {
        let audio = TutorAudioIO()
        var drained = 0
        audio.onDrained = { drained += 1 }
        audio.stop()
        audio.completeResponse()
        XCTAssertEqual(drained, 0)
        XCTAssertFalse(audio.recording)
    }
    func testInternalTranscriptDoesNotBecomeTeacherReplyAndPauseRejectsLateAudio() throws {
        let client = WorkspaceClient()
        client.pause()
        client.receive(["type": "audio", "turnId": "old", "responseId": "old", "pcm": "YWE="])
        client.receive(["type": "responseDone", "turnId": "old", "text": "迟到回复"])
        XCTAssertEqual(client.reply, "")
        XCTAssertFalse(client.connected)
        XCTAssertFalse(client.listening)
    }
}
