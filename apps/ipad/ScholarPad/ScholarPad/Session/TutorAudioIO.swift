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
    /// 每个 16k Int16 帧。只在内存里交给实时会话，不落盘。
    var onFrame: ((Data) -> Void)?
    var onSpeechStart: (() -> Void)?
    var onDrained: (() -> Void)?
    var onError: ((String) -> Void)?
    /// 麦克风实时音量（0…1），只给界面画声波，不存录音。
    var onLevel: ((Double) -> Void)?
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
    // 诊断：本轮已排进/已播完的帧数（只在 Debug 版输出日志）。
    private var scheduledFrames = 0
    private var playedFrames = 0
    private var configObserver: NSObjectProtocol?
    private func trace(_ event: String) {
        #if DEBUG
        let session = AVAudioSession.sharedInstance()
        let outputs = session.currentRoute.outputs.map { "\($0.portType.rawValue)" }.joined(separator: ",")
        NSLog("AIDTL-AUDIO %@ engine=%@ player=%@ cat=%@ mode=%@ out=%@ vol=%.2f mixer=%.2f sched=%d played=%d rec=%@",
              event, engine?.isRunning == true ? "run" : (engine == nil ? "nil" : "stop"), player?.isPlaying == true ? "on" : "off",
              session.category.rawValue, session.mode.rawValue, outputs, session.outputVolume,
              engine?.mainMixerNode.outputVolume ?? -1, scheduledFrames, playedFrames, recording ? "y" : "n")
        #endif
    }
    /// 开启回声消除后 iOS 会重新配置音频并停掉引擎（2026-11-08 真机：engine=stop 后老师的声音一帧没播出）；
    /// 停了就重新启动，并接着播还没播完的缓冲。
    @discardableResult private func restartIfStopped(_ reason: String) -> Bool {
        guard let engine else { return false }
        if engine.isRunning { return true }
        do {
            try engine.start()
            if queued > 0 || prompting > 0 { player?.play() }
            trace("restarted:\(reason)")
            return true
        } catch {
            trace("restartFailed:\(reason)")
            return false
        }
    }
    private func observe(_ engine: AVAudioEngine) {
        if let configObserver { NotificationCenter.default.removeObserver(configObserver) }
        configObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.trace("configChange"); self?.restartIfStopped("configChange") }
        }
    }

    /// 系统音量为 0（或接近 0）：声音照常播放但听不见。
    var outputMuted: Bool { AVAudioSession.sharedInstance().outputVolume < 0.05 }

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
                    if !bytes.isEmpty {
                        let rms = sqrt(energy / Double(bytes.count / 2))
                        self.peakInputRMS = max(self.peakInputRMS, rms)
                        self.onLevel?(rms)
                    }
                    if self.prompting == 0 { self.onFrame?(data) }
                    if self.prompting > 0 { return }
                    let pcm = self.detector.append(data)
                    if !self.speechStarted && self.detector.hearingSpeech {
                        self.speechStarted = true; self.onSpeechStart?()
                    }
                    if let pcm { self.speechStarted = false; self.onTurn?(pcm) }
                }
            }
            self.engine = engine; observe(engine); try engine.start(); recording = true; trace("listen"); restartIfStopped("listen")
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
        let frames = Int(buffer.frameLength)
        if scheduledFrames == 0 { trace("firstAudio") }
        scheduledFrames += frames
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { @Sendable [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.playbackID == id else { return }
                self.playedFrames += frames
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
            try engine.start(); self.engine = engine; player = node; observe(engine); trace("playbackEngine")
        }
        guard let player, restartIfStopped("play") else { throw WorkspaceError.unavailable }
        return player
    }

    /// 固定短句预先用老师同一个实时语音录好（apps/agent-host/scripts/make-voice-prompts.ts 生成，24k/16 位/单声道）。
    /// 2026-11-08 真机：系统 TTS 和老师声音不一样且有破音，所以能用预录的就不现合成。
    static let recordedPrompts: [String: String] = [
        "嗯，我想想。": "ack-1", "好，我看看。": "ack-2", "嗯，让我想一下。": "ack-3", "好，我来看一看。": "ack-4",
        "刚才没听清，你再说一遍好吗？": "unheard", "老师刚才没想好，你再说一遍好吗？": "unsure",
    ]
    static func recordedSamples(for text: String) -> [Float]? {
        guard let name = recordedPrompts[text], let url = Bundle.main.url(forResource: name, withExtension: "pcm"),
              let data = try? Data(contentsOf: url), data.count >= 2 else { return nil }
        let bytes = [UInt8](data)
        return (0..<(bytes.count / 2)).map { i in Float(Int16(bitPattern: UInt16(bytes[i * 2]) | UInt16(bytes[i * 2 + 1]) << 8)) / 32768 }
    }

    /// 本机说一句短提示（不联网，云端连不上时也能说），走同一个播放节点；不算老师回复，不触发 onDrained。
    /// 优先放预录的老师声音；没有录好的句子才用系统合成。
    func say(_ text: String) {
        let id = UUID(); promptID = id
        if let samples = Self.recordedSamples(for: text) { schedulePrompt(samples, id: id); return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
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
        trace("drained"); accepting = false; finished = false; onDrained?()
    }
    func resetInput() { detector = TutorTurnDetector(); speechStarted = false }
    func stopPlayback() {
        if scheduledFrames > 0 { trace("stopPlayback") }
        scheduledFrames = 0; playedFrames = 0
        playbackID = UUID(); promptID = UUID(); player?.stop()
        accepting = false; queued = 0; finished = false; prompting = 0
    }
    func stop() {
        generation = UUID(); stopPlayback()
        if recording { engine?.inputNode.removeTap(onBus: 0) }
        engine?.stop(); engine = nil; player = nil
        onLevel?(0)
        recording = false; starting = false; resetInput()
    }
}
