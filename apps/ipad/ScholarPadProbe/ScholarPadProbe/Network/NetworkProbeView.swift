// 局域网门禁页：连接网关、100 次事件确认、20 次远端语义圆、断线恢复计数。
import SwiftUI

struct NetworkProbeView: View {
    @Bindable var socket: ProbeWebSocket
    let store: ProbeMetricsStore

    var body: some View {
        NavigationStack {
            Form {
                Section("连接（ws://主机:8787/probe，仅家庭局域网明文）") {
                    TextField("Mac 主机名", text: $socket.host)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    LabeledContent("状态") { Text(socket.status).accessibilityIdentifier("networkStatus") }
                    LabeledContent("被拒绝的消息", value: "\(socket.rejectedMessages)")
                    HStack {
                        Button("连接") { socket.connect() }.disabled(socket.isConnected)
                        Spacer()
                        Button("断开", role: .destructive) { socket.disconnect() }.disabled(!socket.isConnected)
                    }
                }
                Section("事件确认（P95 ≤ 150 ms，需 100 次）") {
                    MetricStatsRow(metric: .lanAck, store: store, countIdentifier: "lanAckSampleCount")
                    Button("发 100 次确认") { Task { await socket.runAckBurst() } }
                        .disabled(!socket.isConnected || socket.isBusy)
                }
                Section("远端语义动作（P95 ≤ 300 ms，需 20 次，往返口径）") {
                    MetricStatsRow(metric: .remoteCanvas, store: store, countIdentifier: "remoteCanvasSampleCount")
                    Button("请求 20 次语义圆") { Task { await socket.runSemanticBurst() } }
                        .disabled(!socket.isConnected || socket.isBusy)
                }
                Section("断线恢复（≤ 5000 ms，需 5 次）") {
                    MetricStatsRow(metric: .reconnect, store: store, countIdentifier: "reconnectSampleCount")
                    Text("真机：关 Wi-Fi 10 秒再开，共 5 次。网络恢复到收到首个确认记一次样本。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section {
                    Button("清空网络样本", role: .destructive) {
                        store.clear(.lanAck); store.clear(.remoteCanvas); store.clear(.reconnect)
                    }
                }
            }
            .navigationTitle("局域网门禁")
        }
    }
}
