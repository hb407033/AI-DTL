// 门禁总览页：后续各 Task 把 PencilKit、音频、局域网等探针入口挂到这里。
import SwiftUI

struct ProbeDashboardView: View {
    var body: some View {
        NavigationStack {
            Text("原生 iPad 门禁")
                .font(.largeTitle.bold())
                .navigationTitle("ScholarPad Probe")
        }
    }
}
