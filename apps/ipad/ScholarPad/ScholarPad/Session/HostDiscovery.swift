import SwiftUI

struct LearningHostHealth: Decodable {
    var status: String
    var mode: String
    var discoveryVersion: Int?
    var hostId: String?
    var verifiedID: String? {
        guard status == "ok", mode == "learning-tutor", discoveryVersion == 1,
              let hostId, UUID(uuidString: hostId) != nil else { return nil }
        return hostId
    }
    static func probe(_ host: String) async -> String? {
        guard !host.isEmpty, !host.contains("/"), !host.contains("@"),
              let url = URL(string: "http://\(host):8791/healthz") else { return nil }
        do {
            let (data, response) = try await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 3))
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            return try JSONDecoder().decode(Self.self, from: data).verifiedID
        } catch { return nil }
    }
}

@MainActor
final class HostDiscovery: NSObject, ObservableObject, @preconcurrency NetServiceBrowserDelegate, @preconcurrency NetServiceDelegate {
    struct Candidate: Identifiable, Equatable {
        var id: String
        var address: String
        var name: String
    }
    @Published private(set) var candidates: [Candidate] = []
    @Published private(set) var status = "正在寻找学习主机…"
    private let browser = NetServiceBrowser()
    private var services: [NetService] = []
    private var running = false

    func start() {
        guard !running else { return }
        running = true
        browser.delegate = self
        browser.searchForServices(ofType: "_ai-dtl._tcp.", inDomain: "local.")
    }
    func stop() {
        running = false; browser.stop()
        services.forEach { $0.stop() }; services = []; candidates = []
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        services.append(service); service.delegate = self; service.resolve(withTimeout: 5)
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
        services.removeAll { $0 == service }
        candidates.removeAll { $0.name == service.name }
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        status = "暂未发现主机，可手填地址；请检查本地网络权限。"
    }
    func netServiceDidResolveAddress(_ sender: NetService) {
        guard sender.port == 8791, let name = sender.hostName else { return }
        let address = name.hasSuffix(".") ? String(name.dropLast()) : name
        Task {
            guard let id = await LearningHostHealth.probe(address), running, services.contains(sender) else { return }
            candidates.removeAll { $0.id == id }
            candidates.append(.init(id: id, address: address, name: sender.name))
            status = candidates.count == 1 ? "已发现学习主机" : "发现多台主机，请选择家中的学习主机"
        }
    }
}
