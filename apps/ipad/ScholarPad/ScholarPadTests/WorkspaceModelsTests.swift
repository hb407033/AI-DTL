import XCTest
@testable import ScholarPad

final class WorkspaceModelsTests: XCTestCase {
    func testSharedCameraAndCuratedFixtures() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "workspace-learning-v2", withExtension: "json"))
        struct Fixtures: Decodable { let camera: WorkspaceProblem; let curated: WorkspaceProblem; let emptyRecord: WorkspaceRecord }
        let f = try JSONDecoder().decode(Fixtures.self, from: Data(contentsOf: url))
        for problem in [f.camera, f.curated] {
            var record = f.emptyRecord; record.problem = problem
            XCTAssertNoThrow(try record.validated())
        }
        var invalid = f.emptyRecord; invalid.schemaVersion = 1
        XCTAssertThrowsError(try invalid.validated())
        invalid = f.emptyRecord; invalid.phase = "exploring"
        XCTAssertThrowsError(try invalid.validated())
    }
}
