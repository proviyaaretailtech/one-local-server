import SwiftUI
import WidgetKit

// The app writes a JSON snapshot of the latest order to the shared App Group under this key.
private let snapshotKey = "onecity.latestOrder"

// "group.<app bundle id>": the widget's own bundle id is "<app bundle id>.<target>", so drop the last part.
private var appGroup: String {
  let parts = (Bundle.main.bundleIdentifier ?? "").split(separator: ".")
  return "group." + parts.dropLast().joined(separator: ".")
}

struct OrderSnapshot: Codable {
  let orderId: String
  let status: String      // "Order placed", "Being packed", "On the way", "Delivered"
  let step: Int           // 0...3
  let etaMinutes: Int
  let itemCount: Int
  let total: String       // "₹199"
  let firstItem: String
}

struct OrderEntry: TimelineEntry {
  let date: Date
  let order: OrderSnapshot?
}

struct OrderProvider: TimelineProvider {
  private let sample = OrderSnapshot(orderId: "sample", status: "On the way", step: 2, etaMinutes: 8, itemCount: 3, total: "₹199", firstItem: "Fresh Tomatoes")

  func placeholder(in context: Context) -> OrderEntry { OrderEntry(date: .now, order: sample) }

  func getSnapshot(in context: Context, completion: @escaping (OrderEntry) -> Void) {
    completion(OrderEntry(date: .now, order: context.isPreview ? sample : load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<OrderEntry>) -> Void) {
    // The app reloads the widget whenever the order changes; refresh at least every 15 minutes.
    completion(Timeline(entries: [OrderEntry(date: .now, order: load())], policy: .after(.now.addingTimeInterval(15 * 60))))
  }

  private func load() -> OrderSnapshot? {
    guard let json = UserDefaults(suiteName: appGroup)?.string(forKey: snapshotKey),
          let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(OrderSnapshot.self, from: data)
  }
}

struct Steps: View {
  let step: Int
  var body: some View {
    HStack(spacing: 4) {
      ForEach(0..<4) { i in
        Capsule().fill(i <= step ? Color("neon") : Color.white.opacity(0.18)).frame(height: 4)
      }
    }
  }
}

struct OrderWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: OrderEntry

  var body: some View {
    Group {
      if let order = entry.order, order.step < 3 { active(order) } else { idle(entry.order) }
    }
    .containerBackground(for: .widget) { Color("ink") }
    .widgetURL(URL(string: entry.order.map { "onecity://order/\($0.orderId)" } ?? "onecity://"))
  }

  private var brand: some View {
    HStack(spacing: 1) {
      Text("1").font(.system(size: 17, weight: .black)).foregroundStyle(Color("neon"))
      Text("neCity").font(.system(size: 13, weight: .heavy)).foregroundStyle(.white)
    }
  }

  @ViewBuilder private func active(_ order: OrderSnapshot) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack { brand; Spacer(); Text("\(order.etaMinutes) min").font(.system(size: 12, weight: .bold)).foregroundStyle(Color("neon")) }
      Spacer(minLength: 0)
      Text(order.status).font(.system(size: family == .systemSmall ? 18 : 22, weight: .heavy)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.8)
      Text(order.itemCount == 1 ? order.firstItem : "\(order.firstItem) + \(order.itemCount - 1) more")
        .font(.system(size: 11, weight: .medium)).foregroundStyle(Color("mist")).lineLimit(1)
      Steps(step: order.step)
      if family != .systemSmall {
        HStack { Text("Placed").font(.system(size: 9)); Spacer(); Text("Packed").font(.system(size: 9)); Spacer(); Text("On the way").font(.system(size: 9)); Spacer(); Text(order.total).font(.system(size: 11, weight: .bold)) }
          .foregroundStyle(Color("mist"))
      }
    }
  }

  @ViewBuilder private func idle(_ last: OrderSnapshot?) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      brand
      Spacer(minLength: 0)
      Text(last == nil ? "Latur, in minutes." : "Delivered. Enjoy!").font(.system(size: 18, weight: .heavy)).foregroundStyle(.white)
      Text("Groceries, food & more").font(.system(size: 11, weight: .medium)).foregroundStyle(Color("mist"))
      Text("Tap to order →").font(.system(size: 12, weight: .bold)).foregroundStyle(Color("neon"))
    }
  }
}

struct OrderWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "OneCityOrder", provider: OrderProvider()) { entry in
      OrderWidgetView(entry: entry)
    }
    .configurationDisplayName("OneCity order")
    .description("Your latest order's status, at a glance.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
