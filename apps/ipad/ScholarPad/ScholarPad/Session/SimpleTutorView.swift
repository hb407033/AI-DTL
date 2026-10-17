import SwiftUI
import PencilKit
import AVFoundation

/// 家长在场的单模型试用，不调用成长档案与教学编排器。
struct SimpleTutorView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var tutor = SimpleTutorClient()
    @AppStorage("simpleTutorHost") private var host = ""
    @State private var drawing = PKDrawing()
    @State private var clear = 0
    var body: some View {
        VStack(spacing: 12) {
            Text("AI 学科心智学习系统").font(.headline)
            Text("互动老师 · 家长陪伴试用").font(.subheadline)
            HStack {
                TextField("Mac 主机地址，例如 192.168.1.10", text: $host)
                    .textFieldStyle(.roundedBorder).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("连接") { tutor.connect(host: host) }.disabled(tutor.connected)
                Button("停止") { tutor.stop() }
            }
            Text("开启连续对话后，说完停顿约 1.2 秒自动发送语音与画布给千问。老师说完再轮到你；安静书写不上传音频。AI 可能理解错误。")
                .font(.caption).foregroundStyle(.secondary)
            ChildCanvasView(clearToken: clear, onDrawing: { drawing = $0 }, onEvents: { _ in })
                .clipShape(RoundedRectangle(cornerRadius: 12))
            Text(tutor.status).font(.subheadline)
            Text(tutor.usageSummary).font(.caption).foregroundStyle(.secondary)
            ScrollView { Text(tutor.reply).frame(maxWidth: .infinity, alignment: .leading) }.frame(maxHeight: 100)
            HStack {
                Button("清空画布") { clear += 1 }
                Button(tutor.continuous ? "结束连续对话" : "开始连续对话") {
                    if tutor.continuous { tutor.stop() }
                    else { tutor.startContinuous { drawing } }
                }.buttonStyle(.borderedProminent).disabled(!tutor.connected)
                Button(tutor.recording ? "说完了，发给老师" : "和老师说") {
                    if tutor.recording { tutor.finish() }
                    else { tutor.record(drawing: drawing) }
                }.buttonStyle(.bordered).disabled(tutor.continuous || (!tutor.ready && !tutor.recording))
            }
        }.padding().background(Color(white: 0.96)).preferredColorScheme(.light)
            .onDisappear { tutor.stop() }
            .onChange(of: scenePhase) { _, phase in if phase == .background { tutor.stop() } }
    }
}

@MainActor
final class SimpleTutorClient: ObservableObject {
    @Published var status = "填入 Mac 地址，连接后开始。"
    @Published var reply = ""
    @Published var connected = false
    @Published var ready = false
    @Published var recording = false
    @Published var continuous = false
    @Published var usageSummary = "本次连接尚无用量；Token 不等同于账单金额。"
    private var drawingProvider: (() -> PKDrawing)?
    private var detector = TutorTurnDetector()
    private var captureID = UUID()
    private var playbackID = UUID()
    private var queuedAudio = 0
    private var responseFinished = false
    private var rearm: Task<Void, Never>?
    private var rounds = 0, inputTokens = 0, outputTokens = 0, missingUsage = 0
    private var inputSeconds = 0.0
    private var socket: URLSessionWebSocketTask?
    private var generation = UUID()
    private var engine: AVAudioEngine?
    private var playback: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private let audioPlayback: ((Data) throws -> Void)?
    private var audioError: String?
    private var pcm = Data()
    private var snapshot = ""
    private var timeout: Task<Void, Never>?
    private let output = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
    init(audioPlayback: ((Data) throws -> Void)? = nil) { self.audioPlayback = audioPlayback }
    func connect(host: String) {
        stop()
        rounds = 0; inputTokens = 0; outputTokens = 0; missingUsage = 0; inputSeconds = 0
        usageSummary = "本次连接尚无用量；Token 不等同于账单金额。"
        guard let url = URL(string: "ws://\(host.trimmingCharacters(in: .whitespacesAndNewlines)):8790/tutor"), url.host != nil else { status = "请填写有效的 Mac 地址"; return }
        let id = generation
        let task = URLSession.shared.webSocketTask(with: url)
        socket = task; task.resume(); status = "连接老师中…"
        Task {
            do {
                while id == generation {
                    let message = try await task.receive()
                    guard id == generation else { return }
                    guard case .string(let text) = message, let data = text.data(using: .utf8),
                          let event = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                    switch event["type"] as? String {
                    case "ready": connected = true; ready = true; status = "先在画布写下问题，再和老师说。"
                    case "text": reply += event["text"] as? String ?? ""
                    case "audio": if let s = event["data"] as? String, let audio = Data(base64Encoded: s) { receiveAudio(audio) }
                    case "done":
                        rounds += 1
                        if let usage = event["usage"] as? [String: Any],
                           let input = usage["input_tokens"] as? Int, let output = usage["output_tokens"] as? Int {
                            inputTokens += input; outputTokens += output
                        } else { missingUsage += 1 }
                        inputSeconds += event["inputAudioSeconds"] as? Double ?? 0
                        usageSummary = "\(rounds) 轮 · 已上传语音 \(Int(inputSeconds)) 秒 · 已报告输入/输出 \(inputTokens)/\(outputTokens) Token" + (missingUsage > 0 ? " · \(missingUsage) 轮用量未返回" : "")
                        completeResponse()
                    case "error": let reason = event["message"] as? String ?? "连接失败"; stop(); status = reason
                    default: break
                    }
                }
            } catch { if id == generation { stop(); status = "连接中断，请重新连接；画布仍保留。" } }
        }
    }
    func startContinuous(drawing: @escaping () -> PKDrawing) {
        guard connected, ready, !recording else { return }
        drawingProvider = drawing; continuous = true
        record(drawing: drawing())
    }
    func completeResponse() {
        guard connected else { return }
        responseFinished = true
        completePlaybackIfReady()
    }
    private func completePlaybackIfReady() {
        guard responseFinished, queuedAudio == 0 else { return }
        responseFinished = false
        ready = true
        if let audioError { continuous = false; status = audioError; return }
        status = "你可以继续画，再说说你的想法。"
        guard continuous else { return }
        let id = generation
        // 留出扬声器尾音时间，避免下一轮把上一轮尾音收进去。
        rearm?.cancel()
        rearm = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled, let self, self.generation == id, self.continuous,
                  let drawing = self.drawingProvider else { return }
            self.record(drawing: drawing())
        }
    }
    func record(drawing: PKDrawing) {
        guard ready else { return }
        ready = false; stopPlayback(); audioError = nil; responseFinished = false
        detector = TutorTurnDetector(); captureID = UUID()
        let recordingID = captureID
        let id = generation
        Task { [self] in
            let allowed = await AVAudioApplication.requestRecordPermission()
            guard id == generation, recordingID == captureID else { return }
            guard allowed else { continuous = false; ready = true; status = "请在系统设置允许 AI-DTL 使用麦克风。"; return }
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
                try session.setActive(true)
                let bounds = drawing.bounds.isEmpty ? CGRect(x: 0, y: 0, width: 800, height: 600) : drawing.bounds.insetBy(dx: -24, dy: -24)
                let scale = min(1, 1280 / max(bounds.width, bounds.height))
                let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
                let format = UIGraphicsImageRendererFormat(); format.scale = 1
                let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
                    UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
                    drawing.image(from: bounds, scale: scale).draw(in: CGRect(origin: .zero, size: size))
                }
                guard let jpeg = TutorSnapshot.encode(image) else {
                    continuous = false; ready = true; status = "画布内容太多，请缩小内容后再试；本地笔迹未改变。"; return
                }
                snapshot = jpeg.base64EncodedString()
                pcm = Data()
                let capture = AVAudioEngine(); let input = capture.inputNode
                let source = input.outputFormat(forBus: 0)
                guard let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
                      let converter = AVAudioConverter(from: source, to: target) else { throw NSError(domain: "audio", code: 1) }
                // 音频线程回调不能继承 MainActor；仅将复制后的 PCM Data 交回主线程。
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
                        guard let self, self.generation == id, self.captureID == recordingID, self.recording else { return }
                        if self.continuous {
                            if let turn = self.detector.append(data) { self.pcm = turn; self.finish() }
                            else if self.detector.hearingSpeech { self.status = "正在听你说，停顿后自动发送…" }
                        } else if self.pcm.count + data.count <= 960000 { self.pcm.append(data) }
                        else { self.finish() }
                    }
                }
                engine = capture; try capture.start(); recording = true
                status = continuous ? "正在听，你可以直接说；安静 90 秒后自动结束。" : "正在听…再点一次发送（最多 30 秒）"
                let automatic = continuous
                timeout = Task {
                    try? await Task.sleep(for: .seconds(automatic ? 90 : 30))
                    guard !Task.isCancelled, id == generation, recordingID == captureID else { return }
                    if automatic { stop(); status = "长时间未完成发言，已结束连接；需要时重新连接。" }
                    else { finish() }
                }
            } catch { stop(); status = "麦克风启动失败，请重新连接再试。" }
        }
    }
    func finish() {
        guard recording else { return }
        recording = false; captureID = UUID(); timeout?.cancel(); engine?.inputNode.removeTap(onBus: 0); engine?.stop(); engine = nil
        guard pcm.count >= 3200 else { ready = true; status = "刚才太短了，请再说一次。"; return }
        // 自动模式等待期间孩子可能改画布，提交时重取快照而不是发送开麦时的旧图。
        if continuous, let drawing = drawingProvider?() {
            let bounds = drawing.bounds.isEmpty ? CGRect(x: 0, y: 0, width: 800, height: 600) : drawing.bounds.insetBy(dx: -24, dy: -24)
            let image = drawing.image(from: bounds, scale: min(1, 1280 / max(bounds.width, bounds.height)))
            guard let jpeg = TutorSnapshot.encode(image) else { stop(); status = "画布图片生成失败，请缩小内容后重试。"; return }
            snapshot = jpeg.base64EncodedString()
        }
        let audio = pcm; pcm = Data(); let image = snapshot; snapshot = ""; reply = ""
        guard let task = socket else { return }; let id = generation
        status = "老师正在看画布、听你的想法…"
        Task {
            do {
                try await send(["type": "start"], using: task)
                for offset in stride(from: 0, to: audio.count, by: 3200) {
                    guard id == generation else { return }
                    try await task.send(.data(audio.subdata(in: offset..<min(offset + 3200, audio.count))))
                }
                guard id == generation else { return }
                try await send(["type": "finish", "image": image], using: task)
            } catch { if id == generation { stop(); status = "发送失败，请重新连接。" } }
        }
    }
    private func send(_ event: [String: String], using task: URLSessionWebSocketTask) async throws {
        let data = try JSONSerialization.data(withJSONObject: event)
        try await task.send(.string(String(decoding: data, as: UTF8.self)))
    }
    private func play(_ data: Data) throws {
        guard data.count % 2 == 0, data.count > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: AVAudioFrameCount(data.count / 2)) else { return }
        buffer.frameLength = buffer.frameCapacity
        let bytes = [UInt8](data)
        for i in 0..<Int(buffer.frameLength) {
            let raw = UInt16(bytes[i * 2]) | UInt16(bytes[i * 2 + 1]) << 8
            buffer.floatChannelData![0][i] = Float(Int16(bitPattern: raw)) / 32768
        }
        if playback == nil {
            // 录音引擎释放后，先激活播放会话，再创建输出图，避免使用录音前的硬件格式。
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            let engine = AVAudioEngine()
            let node = AVAudioPlayerNode()
            engine.attach(node); engine.connect(node, to: engine.mainMixerNode, format: output)
            try engine.start()
            playback = engine; player = node
        }
        queuedAudio += 1
        let id = playbackID
        player?.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { @Sendable [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.playbackID == id else { return }
                self.queuedAudio = max(0, self.queuedAudio - 1)
                self.completePlaybackIfReady()
            }
        }
        if player?.isPlaying == false { player?.play() }
    }
    func receiveAudio(_ data: Data) {
        guard audioError == nil else { return }
        do {
            if let audioPlayback { try audioPlayback(data) } else { try play(data) }
        } catch {
            stopPlayback()
            audioError = "声音播放失败（\((error as NSError).code)），连接仍保留，可阅读文字并继续说话。"
            status = audioError!
        }
    }
    private func stopPlayback() {
        playbackID = UUID(); queuedAudio = 0
        player?.stop(); playback?.stop(); player = nil; playback = nil
    }
    func stop() {
        generation = UUID(); captureID = UUID(); timeout?.cancel(); rearm?.cancel(); socket?.cancel(with: .goingAway, reason: nil); socket = nil
        engine?.inputNode.removeTap(onBus: 0); engine?.stop(); engine = nil
        stopPlayback(); pcm = Data(); snapshot = ""; audioError = nil
        continuous = false; drawingProvider = nil; responseFinished = false; detector = TutorTurnDetector()
        connected = false; ready = false; recording = false; status = "已停止，画布保留。"
    }
}
