import SwiftUI

/// 对话状态条：一眼看出现在是“在听你说”“老师在说/在想”还是“对话已关闭”。
/// 参照语音输入的常见做法：状态用颜色 + 图标 + 实时声波表示，而不是只靠按钮上的动作文字。
struct VoiceStateBar: View {
    enum Phase: Equatable { case off, connecting, listening, thinking, speaking }
    let phase: Phase
    let micLevel: Int
    let detail: String

    static func phase(connected: Bool, listening: Bool, working: Bool, thinking: Bool) -> Phase {
        guard connected else { return .off }
        if thinking { return .thinking }
        if working { return .speaking }
        return listening ? .listening : .connecting
    }

    private var title: String {
        switch phase {
        case .off: "对话已关闭"
        case .connecting: "对话已开启"
        case .listening: "正在听你说"
        case .thinking: "老师在想"
        case .speaking: "老师在说话"
        }
    }
    private var icon: String {
        switch phase {
        case .off: "mic.slash.fill"
        case .connecting: "mic.fill"
        case .listening: "mic.fill"
        case .thinking: "ellipsis.bubble.fill"
        case .speaking: "speaker.wave.2.fill"
        }
    }
    private var tint: Color {
        switch phase {
        case .off: .gray
        case .connecting, .listening: .green
        case .thinking: .orange
        case .speaking: .blue
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 15, weight: .semibold))
            Text(title).font(.subheadline.weight(.semibold)).accessibilityIdentifier("workspaceVoicePhase")
            if phase == .listening { LevelBars(level: micLevel, tint: tint) }
            if phase == .thinking {
                HStack { ProgressView().controlSize(.small).tint(tint) }
                    .accessibilityElement(children: .contain).accessibilityIdentifier("workspaceThinkingIndicator")
            }
            if phase == .speaking { Image(systemName: "waveform").symbolEffect(.variableColor.iterative) }
            Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                .accessibilityIdentifier("workspaceVoiceStatus")
            Spacer(minLength: 0)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 10).frame(height: 32)
        .background(tint.opacity(phase == .off ? 0.08 : 0.14), in: Capsule())
        .overlay(Capsule().stroke(tint.opacity(phase == .off ? 0 : 0.5), lineWidth: 1))
        .animation(.easeOut(duration: 0.2), value: phase)
    }
}

/// 五根声波竖条，随麦克风音量起伏；静音时仍保留最低高度，让孩子知道“麦克风开着”。
private struct LevelBars: View {
    let level: Int
    let tint: Color
    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(0..<5) { i in
                // 中间高两边低，像声波。
                let shape = [0.6, 0.85, 1.0, 0.85, 0.6][i]
                let height = 4 + 14 * shape * Double(level) / 5
                Capsule().fill(tint).frame(width: 3, height: height)
            }
        }.frame(height: 18).animation(.easeOut(duration: 0.12), value: level)
    }
}
