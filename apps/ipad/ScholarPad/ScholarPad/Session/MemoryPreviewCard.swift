import SwiftUI

/// 任务区中的普通卡片，常驻控制入口仍在卡片之外。
struct MemoryPreviewCard: View {
    let preview: MemoryPreview
    let act: (EventPayload) -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text(preview.childFacingText).font(.title2)
            Text(preview.evidenceSummaryText)
                .font(.body)
                .accessibilityIdentifier("memoryEvidenceSummary")
            HStack(spacing: 12) {
                ForEach(MemoryAssentChoice.allCases, id: \.self) { option in
                    assentButton(option)
                }
            }
        }
        .multilineTextAlignment(.center)
        .padding(24)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
        .padding(24)
    }

    private func assentButton(_ option: MemoryAssentChoice) -> some View {
        Button {
            act(.memoryAssent(candidateId: preview.candidateId, previewNonce: preview.previewNonce, choice: option))
        } label: {
            Text(option.title).frame(width: 180, height: 56)
        }
        .buttonStyle(.bordered)
        .font(.title3)
        .foregroundStyle(Color.primary)
        .accessibilityIdentifier("assent-\(option.rawValue)")
    }
}
