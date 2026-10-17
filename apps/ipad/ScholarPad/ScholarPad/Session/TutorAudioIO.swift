import AVFoundation
import Foundation

/// 从 SimpleTutorClient 已验证的媒体实现提取；不决定教学权限、不连接模型。
@MainActor
final class TutorAudioIO {
    private(set) var recording = false
    // 只保留计数和音量，不保存原始录音；用于区分无输入与低音量。
    private(set) var capturedPCMBytes = 0
    private(set) var peakInputRMS = 0.0
    var onTurn: ((Data) -> Void)?
    var onDrained: (() -> Void)?
    var onError: ((String) -> Void)?
    private var capture: AVAudioEngine?
    private var playback: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var generation = UUID()
    private var playbackID = UUID()
    private var queued = 0
    private var finished = false
    private var accepting = false
    private var detector = TutorTurnDetector()
    private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!

    func listen() async {
        stop()
        capturedPCMBytes = 0; peakInputRMS = 0
        let id = generation
        let allowed = await AVAudioApplication.requestRecordPermission()
        guard id == generation else { return }
        guard allowed else { onError?("请在系统设置允许麦克风。"); return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            let engine = AVAudioEngine(), input = engine.inputNode
            let source = input.outputFormat(forBus: 0)
            guard let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
                  let converter = AVAudioConverter(from: source, to: target) else { throw WorkspaceError.unavailable }
            input.installTap(onBus: 0, bufferSize: 2048, format: source) { @Sendable [weak self] buffer, _ in
                let capacity = AVAudioFrameCount(Double(buffer.frameLength) * 16000 / source.sampleRate + 32)
                guard let converted = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
                var supplied = false
                converter.convert(to: converted, error: nil) { _, flag in
                    if supplied { flag.pointee = .noDataNow; return nil }
                    supplied = true; flag.pointee = .haveData; return buffer
                }
                guard let samples = converted.int16ChannelData else { return }
                let data = Data(bytes: samples[0], count: Int(converted.frameLength) * 2)
                Task { @MainActor [weak self] in
                    guard let self, self.generation == id, self.recording else { return }
                    self.capturedPCMBytes += data.count
                    let bytes = [UInt8](data)
                    var energy = 0.0
                    for i in stride(from: 0, to: bytes.count, by: 2) {
                        let sample = Double(Int16(bitPattern: UInt16(bytes[i]) | UInt16(bytes[i + 1]) << 8)) / 32768
                        energy += sample * sample
                    }
                    if !bytes.isEmpty { self.peakInputRMS = max(self.peakInputRMS, sqrt(energy / Double(bytes.count / 2))) }
                    if let pcm = self.detector.append(data) { self.stop(); self.onTurn?(pcm) }
                }
            }
            capture = engine; try engine.start(); recording = true
        } catch { stop(); onError?("麦克风启动失败，原稿仍保留。"); }
    }
    func beginResponse() { stop(); accepting = true }
    func play(_ data: Data) throws {
        guard accepting, !data.isEmpty, data.count % 2 == 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(data.count / 2)) else { return }
        buffer.frameLength = buffer.frameCapacity
        let bytes = [UInt8](data)
        for i in 0..<Int(buffer.frameLength) {
            let raw = UInt16(bytes[i * 2]) | UInt16(bytes[i * 2 + 1]) << 8
            buffer.floatChannelData![0][i] = Float(Int16(bitPattern: raw)) / 32768
        }
        if playback == nil {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default); try session.setActive(true)
            let engine = AVAudioEngine(), node = AVAudioPlayerNode()
            engine.attach(node); engine.connect(node, to: engine.mainMixerNode, format: format)
            try engine.start(); playback = engine; player = node
        }
        queued += 1
        let id = playbackID
        player?.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { @Sendable [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.playbackID == id else { return }
                self.queued = max(0, self.queued - 1); self.drain()
            }
        }
        if player?.isPlaying == false { player?.play() }
    }
    func completeResponse() { guard accepting else { return }; finished = true; drain() }
    private func drain() {
        guard accepting, finished, queued == 0 else { return }
        accepting = false; finished = false; onDrained?()
    }
    func stop() {
        generation = UUID(); playbackID = UUID()
        capture?.inputNode.removeTap(onBus: 0); capture?.stop(); capture = nil
        player?.stop(); playback?.stop(); playback = nil; player = nil
        recording = false; accepting = false; queued = 0; finished = false; detector = TutorTurnDetector()
    }
}
