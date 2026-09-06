// 出站队列：给每条证据事件配幂等 id 与会话内单调 clientSeq（设计稿 10.2）。
// ack 移除；断线重连或收到 nack 时按序号重放；宿主同一 id 只确认一次，重放不会重复计证据。
import Foundation

struct EventOutbox {
    let sessionId: String
    let deviceId: String
    private(set) var nextSeq = 1
    private(set) var pending: [ClientFrame] = []

    init(sessionId: String, deviceId: String) {
        self.sessionId = sessionId
        self.deviceId = deviceId
    }

    mutating func enqueue(_ payload: EventPayload, source: EvidenceSource, occurredAt: Int64, quality: EvidenceQuality = .confirmed) -> ClientFrame {
        let id = UUID().uuidString
        let event = EvidenceEvent(eventId: id, clientSessionId: sessionId, deviceId: deviceId, clientSeq: nextSeq,
                                  occurredAt: occurredAt, quality: quality, source: source, payload: payload)
        let frame = ClientFrame(id: id, clientSeq: nextSeq, sessionId: sessionId, sentAt: occurredAt, event: event)
        nextSeq += 1
        pending.append(frame)
        return frame
    }

    mutating func acknowledge(id: String) {
        pending.removeAll { $0.id == id }
    }

    func replayFrom(seq: Int) -> [ClientFrame] {
        pending.filter { $0.clientSeq >= seq }
    }
}
