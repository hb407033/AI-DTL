// App 入口：阶段 0 原生 iPad 门禁探针，只承载各项门禁测量页面，不含课程逻辑。
import SwiftUI

@main
struct ScholarPadProbeApp: App {
    var body: some Scene {
        WindowGroup {
            ProbeDashboardView()
        }
    }
}
