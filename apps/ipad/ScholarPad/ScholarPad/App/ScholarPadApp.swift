// App 入口：正式儿童端，只有一块屏——会话画布（设计稿 8.1 单屏原则）。
import SwiftUI

@main
struct ScholarPadApp: App {
    // 显式 selection 绑定：浮动 TabBar 样式下，任一 tab 内部状态变化都可能把无绑定的 TabView 重置回第一个 tab。
    @State private var selectedTab = 0

    var body: some Scene {
        WindowGroup {
            NavigationStack {
              if ProcessInfo.processInfo.arguments.contains("--legacy-experiments") || ProcessInfo.processInfo.arguments.contains("--fresh-session") {
              TabView(selection: $selectedTab) {
                SimpleTutorView().tabItem { Label("互动老师", systemImage: "waveform") }.tag(0)
                ChildSessionView().tabItem { Label("教学实验室", systemImage: "pencil.and.outline") }.tag(1)
                FractionLearningView().tabItem { Label("分数探索", systemImage: "divide.square") }.tag(2)
              }
              .onAppear { if ProcessInfo.processInfo.arguments.contains("--fresh-session") { selectedTab = 1 } }
              .toolbar {
                  ToolbarItem(placement: .topBarLeading) {
                      NavigationLink("拍照探索（调试）") { LearningWorkspaceView() }
                          .accessibilityIdentifier("workspaceDebugEntry")
                  }
              }
              } else {
                  LearningWorkspaceView()
              }
            }
        }
    }
}
