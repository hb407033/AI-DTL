import SwiftUI

struct LineScaffoldView: View {
    @ObservedObject var model: LineScaffoldModel
    let host: String
    var body: some View {
        if let offer = model.current {
            VStack(alignment: .leading, spacing: 12) {
                Text("老师的提示 · 不改动你的原稿").font(.headline)
                Text("我理解你说的“\(offer.anchor.sourceQuote)”是：\(offer.meaning)。整体是 \(offer.anchor.whole) \(offer.anchor.unit)。")
                if offer.status == "offered" || offer.status == "consented" {
                    Text("要不要用一条线帮你表示？先核对上面的理解。")
                    Button(model.busy ? "正在准备…" : "可以，画给我看看") {
                        Task { await model.act("consent", host: host) }
                    }.disabled(model.busy).accessibilityIdentifier("scaffoldConsent")
                    Button("先不用") { Task { await model.act("invalidate", host: host) } }
                        .accessibilityIdentifier("scaffoldDecline")
                } else if let line = offer.line, line.quantityLabel(selected: 1) != nil {
                    Text("每段 \(line.quantityLabel(selected: 1) ?? "")；点选你想表示的部分。")
                    ScrollView(.horizontal) {
                        HStack(spacing: 2) {
                            ForEach(0..<line.partitions, id: \.self) { index in
                                Button {
                                    var selected = Set(offer.selectedParts)
                                    if selected.contains(index) { selected.remove(index) } else { selected.insert(index) }
                                    Task { await model.act("select", host: host, selectedParts: selected.sorted()) }
                                } label: {
                                    Rectangle().fill(offer.selectedParts.contains(index) ? Color.accentColor : Color.secondary.opacity(0.15))
                                        .frame(width: max(44, 280 / CGFloat(line.partitions)), height: 48)
                                        .overlay(Rectangle().stroke(.primary, lineWidth: 1))
                                }.buttonStyle(.plain).disabled(model.busy)
                                    .accessibilityLabel("第 \(index + 1) 段")
                                    .accessibilityValue(offer.selectedParts.contains(index) ? "已选" : "未选")
                                    .accessibilityIdentifier("scaffoldPart\(index)")
                            }
                        }.padding(2)
                    }
                    Text("在提示上选了 \(offer.selectedParts.count) / \(line.partitions) 段（\(line.quantityLabel(selected: offer.selectedParts.count) ?? "")）")
                        .accessibilityIdentifier("scaffoldSelection")
                    Button("隐藏提示，我自己继续") { Task { await model.act("hide", host: host) } }
                        .accessibilityIdentifier("scaffoldHide")
                }
                Button("这个理解不对，撤下提示") { Task { await model.act("invalidate", host: host) } }
                    .accessibilityIdentifier("scaffoldCorrect")
                if !model.message.isEmpty { Text(model.message).font(.footnote) }
            }.padding().background(.blue.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        }
    }
}
