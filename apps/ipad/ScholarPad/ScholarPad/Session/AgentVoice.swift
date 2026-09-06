// Agent 口播的临时实现：Codex 实时音频尚未接通（门禁 BLOCKED），先用系统合成语音把 speak 读出来。
// 孩子的任何输入都先打断（设计稿 8.2 可打断）；接通实时音频后替换这里，界面不变。
import AVFoundation

@MainActor
final class AgentVoice {
    private let synthesizer = AVSpeechSynthesizer()

    func speak(_ text: String) {
        interrupt()
        guard !text.isEmpty else { return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.9
        synthesizer.speak(utterance)
    }

    func interrupt() {
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
    }
}
