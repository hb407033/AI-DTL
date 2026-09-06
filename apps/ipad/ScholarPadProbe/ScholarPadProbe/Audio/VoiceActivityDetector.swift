// 语音活动检测（VAD）：纯逻辑、无音频依赖，供本地打断使用。
// 不用固定阈值：先测一段噪声底，阈值 = max(绝对下限, 噪声底 × 倍率)，不同房间、不同麦克风路由下才不会一开口就误触发或永不触发。
// attack / release 以毫秒计，时间按每帧实际时长累加；帧时长由音频缓冲实际长度算出，不假定固定帧数。
import Foundation

struct VoiceActivityDetector {
    struct Config: Equatable {
        var calibrationMs: Double = 1000
        var noiseRatio: Float = 3
        var minThreshold: Float = 0.01
        var attackMs: Double = 60
        var releaseMs: Double = 300
    }

    enum Event: Equatable {
        case calibrated(threshold: Float)
        /// onsetTag 是 attack 窗口第一帧携带的标签（引擎传音频 hostTime），打断延迟从它算起
        case speechStarted(onsetTag: UInt64)
        case speechEnded
    }

    let config: Config
    /// 校准完成前为 nil，此期间任何帧都不触发。
    private(set) var threshold: Float?

    private var calibrationElapsedMs = 0.0
    private var calibrationWeightedRms = 0.0
    private var speaking = false
    private var aboveMs = 0.0
    private var belowMs = 0.0
    private var onsetTag: UInt64 = 0

    init(config: Config = Config()) {
        self.config = config
    }

    mutating func push(rms: Float, frameMs: Double, tag: UInt64 = 0) -> Event? {
        guard let threshold else {
            calibrationElapsedMs += frameMs
            calibrationWeightedRms += Double(rms) * frameMs   // 按时长加权，长短帧混用也不偏
            guard calibrationElapsedMs >= config.calibrationMs else { return nil }
            let noiseFloor = Float(calibrationWeightedRms / calibrationElapsedMs)
            let resolved = max(config.minThreshold, noiseFloor * config.noiseRatio)
            self.threshold = resolved
            return .calibrated(threshold: resolved)
        }

        if rms >= threshold {
            belowMs = 0
            guard !speaking else { return nil }
            if aboveMs == 0 { onsetTag = tag }   // attack 窗口第一帧
            aboveMs += frameMs
            guard aboveMs >= config.attackMs else { return nil }
            speaking = true
            aboveMs = 0
            return .speechStarted(onsetTag: onsetTag)
        } else {
            aboveMs = 0
            guard speaking else { return nil }
            belowMs += frameMs
            guard belowMs >= config.releaseMs else { return nil }
            speaking = false
            belowMs = 0
            return .speechEnded
        }
    }
}
