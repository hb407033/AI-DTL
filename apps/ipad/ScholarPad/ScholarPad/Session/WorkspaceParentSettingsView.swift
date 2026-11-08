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
    /// 默认关。打开后才走直连；失败或没有密钥时仍用原来的主机对话。
    @AppStorage("realtimeMode") private var realtimeMode = false
    @State private var handoutCode = ""
    @State private var claimStatus = ""
    var claimRealtime: (String) async throws -> Void = { _ in throw RealtimeKeyError.unavailable }
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
                Section("实时对话") {
                    Toggle("直连实时对话", isOn: $realtimeMode)
                        .accessibilityIdentifier("workspaceRealtimeMode")
                    Text("默认关闭。打开后用本机已领取的连接；没有连接或连不上时，仍用原来的主机对话。")
                        .font(.footnote).foregroundStyle(.secondary)
                    SecureField("6位口令", text: $handoutCode)
                        .keyboardType(.numberPad)
                        .accessibilityIdentifier("workspaceRealtimeCode")
                    Button("领取") {
                        let code = handoutCode
                        handoutCode = ""
                        Task {
                            do {
                                try await claimRealtime(code)
                                claimStatus = "已放进本机钥匙串。界面不显示密钥。"
                            } catch { claimStatus = "这次没领到。口令不会留在屏幕上。" }
                        }
                    }.disabled(handoutCode.count != 6 || connected || busy)
                        .accessibilityIdentifier("workspaceRealtimeClaim")
                    if !claimStatus.isEmpty { Text(claimStatus).font(.footnote).accessibilityIdentifier("workspaceRealtimeClaimStatus") }
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
