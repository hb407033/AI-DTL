// 语义对象层：叠在笔迹层之上、只读、不接收触摸。它只画 SemanticScene 里的对象，拿不到 PKDrawing。
import SwiftUI

struct SemanticOverlayView: View {
    let scene: SemanticScene

    var body: some View {
        Canvas { context, _ in
            for circle in scene.circles {
                let rect = CGRect(
                    x: circle.center.x - circle.radius,
                    y: circle.center.y - circle.radius,
                    width: circle.radius * 2,
                    height: circle.radius * 2
                )
                context.stroke(Path(ellipseIn: rect), with: .color(.blue), lineWidth: 3)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
