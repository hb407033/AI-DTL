import XCTest
import UIKit
@testable import ScholarPad

final class PhotoCaptureFeedbackTests: XCTestCase {
    @MainActor func testRecognitionReportsActualRequestStages() async throws {
        struct Fixture: Decodable { var emptyRecord: WorkspaceRecord }
        let fixtureURL = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "workspace-learning-v2", withExtension: "json"))
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: fixtureURL))
        var stages: [String] = []
        var model: ProblemCaptureModel!
        model = ProblemCaptureModel(transport: { request in
            stages.append(model.status)
            let url = request.url!
            let data: Data
            if url.path == "/workspace/sessions" {
                XCTAssertTrue(model.status.contains("连接"))
                data = try JSONEncoder().encode(fixture.emptyRecord)
            } else if url.path.contains("/media") {
                let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
                XCTAssertTrue(model.status.contains(body["kind"] as? String == "problemPhoto" ? "上传" : "预览"))
                data = try JSONSerialization.data(withJSONObject: ["mediaId": UUID().uuidString])
            } else {
                XCTAssertTrue(model.status.contains("识别"))
                throw URLError(.timedOut)
            }
            return (data, HTTPURLResponse(url: url, statusCode: 201, httpVersion: nil, headerFields: nil)!)
        })
        model.host = "192.0.2.1"; model.currentUnit = "小数乘法"
        let photo = UIGraphicsImageRenderer(size: CGSize(width: 80, height: 80)).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 80, height: 80))
        }
        model.capture(photo); await model.usePhoto()
        XCTAssertEqual(stages.count, 4)
        XCTAssertFalse(model.busy)
        XCTAssertNotNil(model.photo)
        XCTAssertTrue(model.status.contains("重试"))
        model = nil
    }
    @MainActor func testUnreadableCaptureReportsErrorAndKeepsPreviousPhoto() {
        let model = ProblemCaptureModel()
        let photo = UIGraphicsImageRenderer(size: CGSize(width: 80, height: 80)).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 80, height: 80))
        }
        model.capture(photo)
        let previous = model.photo?.jpegData(compressionQuality: 0.8)
        model.capture(UIImage())
        XCTAssertNotNil(model.photoCaptureError)
        XCTAssertEqual(model.photo?.jpegData(compressionQuality: 0.8), previous)
        model.capture(photo)
        XCTAssertNil(model.photoCaptureError)
    }
}
