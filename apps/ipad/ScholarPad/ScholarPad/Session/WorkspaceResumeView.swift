import SwiftUI

struct WorkspaceResumeView: View {
    let summary: WorkspaceResumeSummary
    let independent: () -> Void
    let review: () -> Void
    let talk: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("接着上次的探索").font(.headline)
            if let expression = summary.childExpression {
                Text("上次留下的表达（可核对）").font(.caption).foregroundStyle(.secondary)
                Text(expression).lineLimit(5).accessibilityIdentifier("workspaceResumeQuote")
            } else {
                Text("原题和笔迹还在。你想从哪里继续？")
            }
            Text("现在还有什么想弄清楚？").font(.subheadline)
            Button("继续想一想", action: independent).accessibilityIdentifier("workspaceResumeIndependent")
            Button("回看作品历程", action: review).accessibilityIdentifier("workspaceResumeReview")
            Button("和老师接着聊", action: talk).accessibilityIdentifier("workspaceResumeTalk")
        }
        .padding().frame(maxWidth: .infinity, alignment: .leading)
        .background(.blue.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }
}
