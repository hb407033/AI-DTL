import SwiftUI

/// 只有显式按下按钮才提交确认；失败时保留全文与重试入口。
struct FirstUseNoticeView: View {
    let notice: ChildFirstUseNotice
    let isBusy: Bool
    let acknowledge: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("开始前，先了解一下").font(.headline)
            Text(notice.text).fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("firstUseNoticeText")
            Button("我看过并理解了") { acknowledge() }
                .buttonStyle(.bordered)
                .disabled(isBusy)
                .accessibilityIdentifier("firstUseNoticeAcknowledge")
        }
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}
