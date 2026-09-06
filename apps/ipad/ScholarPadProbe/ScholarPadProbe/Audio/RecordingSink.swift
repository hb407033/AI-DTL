// 录音回放用的内存缓冲。音频线程只做定长 memcpy 与原子游标更新；PCM 永远不落文件，回放完即清零。
import AVFAudio
import Synchronization

final class RecordingSink: @unchecked Sendable {
    let format: AVAudioFormat
    private let buffer: AVAudioPCMBuffer
    private let capacity: Int
    private let written = Atomic<Int>(0)
    private let armed = Atomic<Bool>(false)

    init(sampleRate: Double, seconds: Double) {
        format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
        capacity = Int(sampleRate * seconds)
        buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(capacity))!
    }

    func arm() {
        written.store(0, ordering: .sequentiallyConsistent)
        armed.store(true, ordering: .sequentiallyConsistent)
    }

    func disarm() {
        armed.store(false, ordering: .sequentiallyConsistent)
    }

    /// 音频线程调用。只拷第 0 声道，满了就丢，不阻塞。
    func write(_ incoming: AVAudioPCMBuffer) {
        guard armed.load(ordering: .relaxed) else { return }
        let offset = written.load(ordering: .relaxed)
        let count = min(Int(incoming.frameLength), capacity - offset)
        guard count > 0, let src = incoming.floatChannelData, let dst = buffer.floatChannelData else { return }
        memcpy(dst[0] + offset, src[0], count * MemoryLayout<Float>.size)
        written.store(offset + count, ordering: .relaxed)
    }

    /// 取出已录内容用于回放。返回的是内部缓冲本身，回放结束前不得再 arm()。
    func takeForPlayback() -> AVAudioPCMBuffer? {
        let count = written.load(ordering: .sequentiallyConsistent)
        guard count > 0 else { return nil }
        buffer.frameLength = AVAudioFrameCount(count)
        return buffer
    }

    /// 回放完立即清零，不留任何家庭声音。
    func clear() {
        if let data = buffer.floatChannelData { memset(data[0], 0, capacity * MemoryLayout<Float>.size) }
        buffer.frameLength = 0
        written.store(0, ordering: .sequentiallyConsistent)
    }
}
