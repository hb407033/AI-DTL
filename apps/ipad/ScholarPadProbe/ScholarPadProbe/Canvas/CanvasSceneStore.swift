// 语义层场景的共享持有者：画布页显示它，网络页收到远端语义动作后改它。仍然拿不到 PKDrawing。
import Observation

@MainActor
@Observable
final class CanvasSceneStore {
    var scene = SemanticScene()
}
