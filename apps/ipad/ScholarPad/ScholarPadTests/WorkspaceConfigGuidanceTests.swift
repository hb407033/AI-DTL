import XCTest
@testable import ScholarPad

/// Task 2: 缺配置引导到家长设置。
/// 空主机 → needsConfig=true，不发请求，status 含"家长设置"；空单元按默认说法照常识别。
final class WorkspaceConfigGuidanceTests: XCTestCase {
    private func makeImage() -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 100, height: 100))
        return renderer.image { ctx in
            UIColor.red.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 100, height: 100))
        }
    }

    @MainActor
    func testEmptyHostSetsNeedsConfig() async {
        let cache = WorkspaceCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent("cfg-\(UUID().uuidString)"))
        let model = ProblemCaptureModel(cache: cache)
        model.capture(makeImage())
        model.host = ""
        model.currentUnit = "小数乘法"
        await model.usePhoto()
        XCTAssertTrue(model.needsConfig, "空主机应设 needsConfig")
        XCTAssertFalse(model.busy, "不应发请求")
        XCTAssertTrue(model.status.contains("家长设置"), "status 应引导到家长设置: \(model.status)")
    }

    @MainActor
    func testEmptyUnitDoesNotBlockRecognition() async {
        let cache = WorkspaceCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent("cfg-\(UUID().uuidString)"))
        let model = ProblemCaptureModel(cache: cache)
        model.capture(makeImage())
        model.host = "127.0.0.1"
        model.currentUnit = ""
        await model.usePhoto()
        XCTAssertFalse(model.needsConfig, "没选单元不应挡住识别: \(model.status)")
        XCTAssertFalse(model.status.contains("选择当前单元"), "不应再要求家长先选单元: \(model.status)")
    }

    @MainActor
    func testValidConfigDoesNotSetNeedsConfig() async {
        let cache = WorkspaceCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent("cfg-\(UUID().uuidString)"))
        let model = ProblemCaptureModel(cache: cache)
        model.capture(makeImage())
        model.host = "127.0.0.1"
        model.currentUnit = "小数乘法"
        await model.usePhoto()
        // 连接失败但配置有效 — 不应因配置缺失设 needsConfig
        XCTAssertFalse(model.needsConfig, "有效配置不应设 needsConfig: \(model.status)")
    }
}
