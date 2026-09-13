import SwiftUI

/// 使用原始透明品牌图；只限定布局尺寸，不改变资源内容。
struct BrandLogoView: View {
    var body: some View {
        VStack(spacing: 2) {
            Image("brand/ai-dtl-logo")
            .resizable()
            .scaledToFit()
            .frame(width: 144, height: 48)
            .accessibilityLabel("AI-DTL，AI 学科心智学习系统")
            .accessibilityIdentifier("brandLogo")
            Text("AI 学科心智学习系统")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
