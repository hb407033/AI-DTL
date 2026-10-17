import Foundation

/// 本地能量端点检测，不是语音识别：安静时只保留 400ms 前滚，不上传静音。
/// 当前为轮流说话模式，不能区分环境人声；阈值需要真机环境验收。
/// silenceBytes 默认 64000（16kHz/PCM16 下 2 秒）：思考停顿不切断，2 秒静音才结束一轮。
struct TutorTurnDetector {
    private let silenceBytes: Int
    private var buffer = Data()
    private var voicedBytes = 0
    private var quietBytes = 0
    private var started = false
    var bufferedBytes: Int { buffer.count }
    var hearingSpeech: Bool { started && voicedBytes >= 7680 }

    init(silenceBytes: Int = 64_000) { self.silenceBytes = silenceBytes }

    mutating func append(_ data: Data) -> Data? {
        guard !data.isEmpty, data.count % 2 == 0 else { return nil }
        let bytes = [UInt8](data)
        var energy = 0.0
        for i in stride(from: 0, to: bytes.count, by: 2) {
            let sample = Double(Int16(bitPattern: UInt16(bytes[i]) | UInt16(bytes[i + 1]) << 8)) / 32768
            energy += sample * sample
        }
        let voiced = sqrt(energy / Double(bytes.count / 2)) >= 0.015
        buffer.append(data)
        if voiced { started = true; voicedBytes += data.count; quietBytes = 0 }
        else if started { quietBytes += data.count }
        else if buffer.count > 12800 { buffer.removeFirst(buffer.count - 12800) }

        if started && (quietBytes >= silenceBytes || buffer.count >= 960000) {
            let result = voicedBytes >= 7680 ? Data(buffer.prefix(960000)) : nil
            self = Self(silenceBytes: silenceBytes)
            return result
        }
        return nil
    }
}
