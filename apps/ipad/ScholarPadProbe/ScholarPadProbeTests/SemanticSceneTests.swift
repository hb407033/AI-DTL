// 语义层模型测试：带身份和归属的语义对象，只能整体替换或按 id 更新，与 PencilKit 笔迹层无任何耦合。
import XCTest
@testable import ScholarPadProbe

final class SemanticSceneTests: XCTestCase {
    private func circle(_ id: String, x: CGFloat = 10) -> SemanticCircle {
        SemanticCircle(id: id, owner: .agent, center: CGPoint(x: x, y: 20), radius: 30)
    }

    func testUpsertWithSameIdReplacesInsteadOfDuplicating() {
        var scene = SemanticScene()
        scene.upsert(circle("c1", x: 10))
        scene.upsert(circle("c1", x: 99))
        XCTAssertEqual(scene.circles.count, 1)
        XCTAssertEqual(scene.circles.first?.center.x, 99)
    }

    func testReplaceAllDropsPreviousObjects() {
        var scene = SemanticScene()
        scene.upsert(circle("old"))
        scene.replaceAll([circle("a"), circle("b")])
        XCTAssertEqual(scene.circles.map(\.id), ["a", "b"])
    }

    func testClearEmptiesScene() {
        var scene = SemanticScene()
        scene.upsert(circle("c1"))
        scene.clear()
        XCTAssertTrue(scene.circles.isEmpty)
    }
}
