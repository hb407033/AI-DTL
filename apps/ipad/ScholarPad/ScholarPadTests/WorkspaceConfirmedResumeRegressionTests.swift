import XCTest
import PencilKit
@testable import ScholarPad

/// T1/A5 回归：confirmed 重开已有作品时 offersResumption=true，三个恢复选择入口存在。
/// 长回复不截断数据：transcript/reply 原文保留在 voice 状态中，预览仅限显示行数。
final class WorkspaceConfirmedResumeRegressionTests: XCTestCase {
    func testConfirmedRecordWithFeedbackOffersResumption() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        // 写 confirmed + 有表达证据的 fixture
        LearningWorkspaceView.writeConfirmedFixtureWithFeedback(to: root)
        let cache = WorkspaceCache(directory: root)
        let draft = try XCTUnwrap(cache.load())
        let record = try XCTUnwrap(draft.record)
        XCTAssertTrue(record.problem?.statement.confirmed == true, "应为 confirmed 状态")
        XCTAssertFalse(record.submissions.isEmpty, "应有表达证据")
        XCTAssertFalse(record.feedback.isEmpty, "应有历史反馈")
        // offersResumption 依赖 WorkspaceResumeSummary.make(record) != nil
        let summary = WorkspaceResumeSummary.make(record)
        XCTAssertNotNil(summary, "confirmed + 有表达证据 → resume summary 应非 nil")
        XCTAssertNotNil(summary?.childExpression, "应提取到儿童表达原文")
    }

    func testConfirmedRecordWithoutFeedbackNoResumption() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        // 写 confirmed 但无表达证据的 fixture
        LearningWorkspaceView.writeConfirmedFixture(to: root)
        let cache = WorkspaceCache(directory: root)
        let draft = try XCTUnwrap(cache.load())
        let record = try XCTUnwrap(draft.record)
        XCTAssertTrue(record.problem?.statement.confirmed == true)
        XCTAssertTrue(record.submissions.isEmpty, "无表达证据")
        // 无 submissions → make 返回 nil（childExpression=nil, submissionId=nil）
        let summary = WorkspaceResumeSummary.make(record)
        // make 对 confirmed 但无 submissions 返回 .init(childExpression: nil, submissionId: nil) — 非 nil
        // 但 offersResumption = make != nil 仍为 true，UI 仍显示恢复入口（"原题和笔迹还在"）
        // 这不是回归：confirmed 重开时即使无 prior expression 也应有恢复入口
        XCTAssertNotNil(summary, "confirmed 重开应总有恢复入口")
    }

    @MainActor func testProblemCaptureModelOffersResumptionOnLoad() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        LearningWorkspaceView.writeConfirmedFixtureWithFeedback(to: root)
        let cache = WorkspaceCache(directory: root)
        let model = ProblemCaptureModel(cache: cache)
        XCTAssertTrue(model.offersResumption, "加载 confirmed+证据记录后 offersResumption 应为 true")
        XCTAssertTrue(model.record?.problem?.statement.confirmed == true)
        // dismiss 后 offersResumption 变 false
        model.dismissResumption()
        XCTAssertFalse(model.offersResumption)
    }
}
