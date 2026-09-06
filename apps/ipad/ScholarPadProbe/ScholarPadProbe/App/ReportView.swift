// 报告页：六项门禁指标总览，并把结果导出成 JSON 文件交给家长（系统分享面板），供 Mac 端 pnpm gate:report 汇总。
import SwiftUI

struct ReportView: View {
    let store: ProbeMetricsStore
    @State private var exportURL: URL?
    @State private var exportError: String?

    private var appBuild: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("六项门禁（真机才算数）") {
                    ForEach(MetricName.allCases, id: \.self) { metric in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(metric.rawValue).font(.caption).foregroundStyle(.secondary)
                            MetricStatsRow(metric: metric, store: store)
                        }
                    }
                }
                Section("导出（只含设备信息与样本，不含录音/笔迹）") {
                    Button("生成结果文件") { export() }
                    if let exportURL {
                        ShareLink(item: exportURL) { Label("分享 \(exportURL.lastPathComponent)", systemImage: "square.and.arrow.up") }
                    }
                    if let exportError { Text(exportError).foregroundStyle(.red) }
                }
            }
            .navigationTitle("门禁报告")
        }
    }

    private func export() {
        let result = DeviceResult.build(from: store, appBuild: appBuild)
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(result)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(result.runId).json")
            try data.write(to: url, options: .atomic)
            exportURL = url
            exportError = nil
        } catch {
            exportError = "导出失败：\(error.localizedDescription)"
        }
    }
}
