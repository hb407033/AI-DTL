import SwiftUI

/// 第一阶段 T1：家长设置集中到一个 sheet，不占儿童画布首屏。
/// 绑定现有 model.host / model.currentUnit，保留已有 Bonjour 选择，不新建配置仓库。
/// 对话或处理期间禁用改地址/题目，不能中途转到其他主机。
struct WorkspaceParentSettingsView: View {
    @Binding var host: String
    @Binding var currentUnit: String
    @ObservedObject var discovery: HostDiscovery
    @Binding var selectedHostId: String
    let chooseHost: (HostDiscovery.Candidate) -> Void
    let connected: Bool
    let busy: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("学习主机") {
                    TextField("Mac 地址", text: $host)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("workspaceHost")
                        .disabled(connected || busy)
                    Text(discovery.status).font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("workspaceDiscoveryStatus")
                    if discovery.candidates.count > 1
                        || (!selectedHostId.isEmpty && !discovery.candidates.contains(where: { $0.id == selectedHostId })) {
                        ForEach(discovery.candidates) { candidate in
                            Button("连接 \(candidate.name)") { chooseHost(candidate) }
                                .disabled(connected || busy)
                        }
                    }
                }
                Section("课程") {
                    TextField("家长设置当前单元（人教版五上）", text: $currentUnit)
                        .accessibilityIdentifier("workspaceUnit")
                        .disabled(connected || busy)
                }
            }
            .navigationTitle("家长设置")
            .toolbar { Button("关闭") { dismiss() }.accessibilityIdentifier("workspaceParentSettingsClose") }
        }
    }
}
