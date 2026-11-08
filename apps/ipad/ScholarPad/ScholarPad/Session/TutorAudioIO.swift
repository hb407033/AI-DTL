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
    var onSpeechStart: (() -> Void)?
    var onDrained: (() -> Void)?
    var onError: ((String) -> Void)?
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var generation = UUID()
    private var playbackID = UUID()
    private var queued = 0
    private var finished = false
    private var accepting = false
    private var detector = TutorTurnDetector()
    private var speechStarted = false
    private var starting = false
    private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
    private let synthesizer = AVSpeechSynthesizer()
    private var promptID = UUID()
    // 正在播的本机提示缓冲数；大于 0 时麦克风声音不进端点检测，免得把提示当成孩子说的话。
    private var prompting = 0

    func listen() async {
        if recording || starting { return }
        stop()
        starting = true
        capturedPCMBytes = 0; peakInputRMS = 0
        let id = generation
        defer { if id == generation { starting = false } }
        let allowed = await AVAudioApplication.requestRecordPermission()
        guard id == generation else { return }
        guard allowed else { onError?("请在系统设置允许麦克风。"); return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker])
            try session.setActive(true)
            let engine = AVAudioEngine(), input = engine.inputNode
            // 输入输出使用同一语音处理引擎，提供扬声器回声消除；不能只在播放时另开 playback 会话。
            try input.setVoiceProcessingEnabled(true)
            let node = AVAudioPlayerNode()
            engine.attach(node); engine.connect(node, to: engine.mainMixerNode, format: format)
            player = node
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
                    if self.prompting > 0 { return }
                    let pcm = self.detector.append(data)
                    if !self.speechStarted && self.detector.hearingSpeech {
                        self.speechStarted = true; self.onSpeechStart?()
                    }
                    if let pcm { self.speechStarted = false; self.onTurn?(pcm) }
                }
            }
            self.engine = engine; try engine.start(); recording = true
        } catch { stop(); onError?("麦克风启动失败，原稿仍保留。"); }
    }
    func beginResponse() { stopPlayback(); accepting = true }
    func play(_ data: Data) throws {
        guard accepting, !data.isEmpty, data.count % 2 == 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(data.count / 2)) else { return }
        buffer.frameLength = buffer.frameCapacity
        let bytes = [UInt8](data)
        for i in 0..<Int(buffer.frameLength) {
            let raw = UInt16(bytes[i * 2]) | UInt16(bytes[i * 2 + 1]) << 8
            buffer.floatChannelData![0][i] = Float(Int16(bitPattern: raw)) / 32768
        }
        let player = try ensurePlayer()
        queued += 1
        let id = playbackID
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { @Sendable [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.playbackID == id else { return }
                self.queued = max(0, self.queued - 1); self.drain()
            }
        }
        if !player.isPlaying { player.play() }
    }
    /// 收音中复用语音处理引擎的播放节点（有回声消除）；没在收音时才单开播放引擎。
    private func ensurePlayer() throws -> AVAudioPlayerNode {
        if engine == nil {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default); try session.setActive(true)
            let engine = AVAudioEngine(), node = AVAudioPlayerNode()
            engine.attach(node); engine.connect(node, to: engine.mainMixerNode, format: format)
            try engine.start(); self.engine = engine; player = node
        }
        guard let player else { throw WorkspaceError.unavailable }
        return player
    }

    /// 本机合成一句短提示（不联网，云端连不上时也能说），走同一个播放节点；不算老师回复，不触发 onDrained。
    func say(_ text: String) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        let id = UUID(); promptID = id
        let target = PromptFormat(format: format)
        synthesizer.write(utterance) { @Sendable [weak self] buffer in
            guard let pcm = buffer as? AVAudioPCMBuffer, pcm.frameLength > 0 else { return }
            let samples = Self.resample(pcm, to: target.format)
            Task { @MainActor [weak self] in self?.schedulePrompt(samples, id: id) }
        }
    }
    private struct PromptFormat: @unchecked Sendable { let format: AVAudioFormat }
    /// 合成器给的是 22.05k 等格式，换成播放节点的 24k 单声道浮点。
    nonisolated private static func resample(_ source: AVAudioPCMBuffer, to target: AVAudioFormat) -> [Float] {
        guard let converter = AVAudioConverter(from: source.format, to: target),
              let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: AVAudioFrameCount(Double(source.frameLength) * target.sampleRate / source.format.sampleRate + 64))
        else { return [] }
        var supplied = false
        converter.convert(to: out, error: nil) { _, flag in
            if supplied { flag.pointee = .noDataNow; return nil }
            supplied = true; flag.pointee = .haveData; return source
        }
        guard let channel = out.floatChannelData?[0] else { return [] }
        return Array(UnsafeBufferPointer(start: channel, count: Int(out.frameLength)))
    }
    private func schedulePrompt(_ samples: [Float], id: UUID) {
        guard promptID == id, !samples.isEmpty, let player = try? ensurePlayer(),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)) else { return }
        buffer.frameLength = buffer.frameCapacity
        samples.withUnsafeBufferPointer { buffer.floatChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
        prompting += 1
        let playback = playbackID
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { @Sendable [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.playbackID == playback else { return }
                self.prompting = max(0, self.prompting - 1)
                // 提示播完后丢掉期间可能收进的回声，从干净状态等孩子开口。
                if self.prompting == 0 { self.resetInput() }
            }
        }
        if !player.isPlaying { player.play() }
    }
    func completeResponse() { guard accepting else { return }; finished = true; drain() }
    private func drain() {
        guard accepting, finished, queued == 0 else { return }
        accepting = false; finished = false; onDrained?()
    }
    func resetInput() { detector = TutorTurnDetector(); speechStarted = false }
    func stopPlayback() {
        playbackID = UUID(); promptID = UUID(); player?.stop()
        accepting = false; queued = 0; finished = false; prompting = 0
    }
    func stop() {
        generation = UUID(); stopPlayback()
        if recording { engine?.inputNode.removeTap(onBus: 0) }
        engine?.stop(); engine = nil; player = nil
        recording = false; starting = false; resetInput()
    }
}
