// 音频探针核心：AVAudioEngine、播放节点、输入 tap、VAD 和录音缓冲全部归本 actor 私有。
// 线程契约：音频线程的 tap 只算 RMS、定长拷贝、往有上限的流里 yield 一个小结构体；不加锁、不分配、不 await、不发网、不写盘。
// 检测与 stop() 在本 actor 上执行；UI 只通过 events 流收结果。
import AVFAudio
import Accelerate
import Foundation

/// tap 每个缓冲产出一条，跨线程传递的最小信息。
struct TapFrame: Sendable {
    let rms: Float
    let frameMs: Double
    let hostTime: UInt64
}

actor AudioProbeCore {
    enum Event: Sendable {
        case permission(granted: Bool)
        case status(String)
        case calibrated(threshold: Float)
        /// latencyMs：开口那一帧采集时刻 → stop() 返回；detectToStopMs：检测器判定 → stop() 返回（诊断用）
        case interrupted(latencyMs: Double, detectToStopMs: Double)
        case trialTimedOut
        case playbackFinished
        case routeChanged(String)
        case failure(String)
    }

    nonisolated let events: AsyncStream<Event>
    private let emit: AsyncStream<Event>.Continuation

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let frames: AsyncStream<TapFrame>
    private let frameSink: AsyncStream<TapFrame>.Continuation
    private var frameTask: Task<Void, Never>?
    private var trialDeadline: Task<Void, Never>?
    private var detector: VoiceActivityDetector?
    private var trialActive = false
    private var toneBuffer: AVAudioPCMBuffer?
    private var recordingSink: RecordingSink?
    private var playbackFormat: AVAudioFormat?
    private var prepared = false
    private let timebase: mach_timebase_info_data_t = {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return info
    }()

    init() {
        (events, emit) = AsyncStream.makeStream(of: Event.self)
        // 帧流只保留最新 64 条：消费端卡住时宁可丢帧，也不能让音频线程等
        (frames, frameSink) = AsyncStream.makeStream(of: TapFrame.self, bufferingPolicy: .bufferingNewest(64))
    }

    // MARK: - 生命周期

    func prepare() async {
        guard !prepared else { return }
        let granted = await AVAudioApplication.requestRecordPermission()
        emit.yield(.permission(granted: granted))
        guard granted else {
            emit.yield(.status("麦克风权限被拒绝"))
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            // voiceChat 模式带回声消除，扬声器放的测试音才不会把自己当成孩子开口；默认走 iPad 自带麦克风与扬声器，允许蓝牙但不强制
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
            try session.setPreferredIOBufferDuration(0.01)   // 争取 10ms 级缓冲，打断预算是 200ms
            try session.setActive(true)

            let inputFormat = engine.inputNode.outputFormat(forBus: 0)
            guard inputFormat.channelCount > 0 else {
                emit.yield(.status("没有可用的麦克风输入（模拟器需在 macOS 允许 Simulator 使用麦克风）"))
                return
            }
            let rate = inputFormat.sampleRate
            let mono = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1)!
            playbackFormat = mono
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: mono)

            let sink = RecordingSink(sampleRate: rate, seconds: 5)
            recordingSink = sink
            let frameSink = self.frameSink
            // bufferSize 只是建议值，实际帧长以缓冲的 frameLength 为准，VAD 按实际时长累计
            engine.inputNode.installTap(onBus: 0, bufferSize: 480, format: inputFormat) { buffer, when in
                guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
                var rms: Float = 0
                vDSP_rmsqv(channel, 1, &rms, vDSP_Length(buffer.frameLength))
                sink.write(buffer)
                let hostTime = when.isHostTimeValid ? when.hostTime : mach_absolute_time()
                frameSink.yield(TapFrame(rms: rms,
                                         frameMs: Double(buffer.frameLength) / buffer.format.sampleRate * 1000,
                                         hostTime: hostTime))
            }
            engine.prepare()
            try engine.start()
            prepared = true
            startFrameConsumer()
            observeSession()
            emit(.status("音频就绪 · \(Int(rate)) Hz · 缓冲 \(String(format: "%.1f", session.ioBufferDuration * 1000)) ms"))
            emit(.routeChanged(Self.describeRoute(session.currentRoute)))
        } catch {
            emit(.failure("音频初始化失败：\(error.localizedDescription)"))
        }
    }

    private func startFrameConsumer() {
        frameTask = Task { [weak self] in
            guard let self else { return }
            for await frame in self.frames {
                await self.handle(frame)
            }
        }
    }

    private func observeSession() {
        let center = NotificationCenter.default
        center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt ?? 0
            Task { await self?.handleInterruption(typeRaw: raw) }
        }
        center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] _ in
            // 路由变化通知可能来自次线程，只取描述文本再回到 actor
            let route = AVAudioSession.sharedInstance().currentRoute
            let text = AudioProbeCore.describeRoute(route)
            Task { await self?.handleRouteChange(text) }
        }
    }

    private func handleInterruption(typeRaw: UInt) {
        guard let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }
        switch type {
        case .began:
            trialActive = false
            emit(.status("音频会话被打断（来电/锁屏），已暂停"))
        case .ended:
            do {
                try AVAudioSession.sharedInstance().setActive(true)
                if !engine.isRunning { try engine.start() }
                emit(.status("音频会话已恢复"))
            } catch {
                emit(.failure("恢复失败：\(error.localizedDescription)"))
            }
        @unknown default:
            break
        }
    }

    private func handleRouteChange(_ description: String) {
        emit(.routeChanged(description))
    }

    /// App 回到前台时确保引擎在跑（锁屏唤醒场景）。
    func resumeIfNeeded() {
        guard prepared, !engine.isRunning else { return }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            try engine.start()
            emit(.status("前台恢复：引擎已重启"))
        } catch {
            emit(.failure("前台恢复失败：\(error.localizedDescription)"))
        }
    }

    // MARK: - 打断测试

    /// 播放 30 秒测试音并开始检测；孩子开口即在本机 stop()，产出一个 local_interrupt_ms 样本。
    func startInterruptTrial() {
        guard prepared, engine.isRunning, let format = playbackFormat else {
            emit(.failure("音频未就绪，先点“初始化音频”"))
            return
        }
        if toneBuffer == nil { toneBuffer = Self.makeTone(format: format, seconds: 30) }
        guard let tone = toneBuffer else { return }
        player.stop()
        // 校准在测试音开始后进行：扬声器串音成为噪声底的一部分
        detector = VoiceActivityDetector()
        trialActive = true
        player.scheduleBuffer(tone, at: nil, options: [])
        player.play()
        emit(.status("正在播放测试音，请开口说话…"))
        trialDeadline?.cancel()
        trialDeadline = Task { [weak self] in
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled else { return }
            await self?.trialTimedOut()
        }
    }

    func stopTrial() {
        trialActive = false
        trialDeadline?.cancel()
        player.stop()
        emit(.status("已停止"))
    }

    private func trialTimedOut() {
        guard trialActive else { return }
        trialActive = false
        player.stop()
        emit(.trialTimedOut)
    }

    private func handle(_ frame: TapFrame) {
        guard trialActive, detector != nil else { return }
        guard let event = detector!.push(rms: frame.rms, frameMs: frame.frameMs, tag: frame.hostTime) else { return }
        switch event {
        case .calibrated(let threshold):
            emit(.calibrated(threshold: threshold))
        case .speechStarted(let onset):
            let detected = mach_absolute_time()
            player.stop()                                   // 先停播放，再做其他任何事
            let stopped = mach_absolute_time()
            trialActive = false
            trialDeadline?.cancel()
            emit(.interrupted(latencyMs: ms(from: onset, to: stopped), detectToStopMs: ms(from: detected, to: stopped)))
        case .speechEnded:
            break
        }
    }

    // MARK: - 录音回放

    func recordAndPlayBack(seconds: Double) async {
        guard prepared, engine.isRunning, let sink = recordingSink else {
            emit(.failure("音频未就绪"))
            return
        }
        player.stop()
        sink.arm()
        emit(.status("正在录音 \(Int(seconds)) 秒…"))
        try? await Task.sleep(for: .seconds(seconds))
        sink.disarm()
        guard let recorded = sink.takeForPlayback() else {
            emit(.failure("没有录到任何声音"))
            return
        }
        emit(.status("回放 \(String(format: "%.1f", Double(recorded.frameLength) / recorded.format.sampleRate)) 秒…"))
        let emit = self.emit
        player.scheduleBuffer(recorded, at: nil, options: [], completionCallbackType: .dataPlayedBack) { _ in
            sink.clear()   // 回放完立即清零
            emit.yield(.playbackFinished)
        }
        player.play()
    }

    // MARK: - 工具

    private func emit(_ event: Event) { emit.yield(event) }

    private func ms(from start: UInt64, to end: UInt64) -> Double {
        guard end >= start else { return 0 }
        return Double(end - start) * Double(timebase.numer) / Double(timebase.denom) / 1_000_000
    }

    private static func makeTone(format: AVAudioFormat, seconds: Double) -> AVAudioPCMBuffer? {
        let frames = AVAudioFrameCount(format.sampleRate * seconds)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames), let data = buffer.floatChannelData?[0] else { return nil }
        buffer.frameLength = frames
        let step = 2 * Double.pi * 440 / format.sampleRate
        for i in 0..<Int(frames) { data[i] = Float(0.2 * sin(step * Double(i))) }   // −14 dBFS 的 440Hz，够响但不刺耳
        return buffer
    }

    private static func describeRoute(_ route: AVAudioSessionRouteDescription) -> String {
        let inputs = route.inputs.map(\.portName).joined(separator: "+")
        let outputs = route.outputs.map(\.portName).joined(separator: "+")
        return "\(inputs) → \(outputs)"
    }
}
