import ActivityKit
import SwiftUI
import WidgetKit

// Must match OneCityOrderAttributes in modules/onecity-live-activity (the app side starts and
// updates the activity; this extension draws it). ActivityKit matches the two by name and shape.
struct OneCityOrderAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var status: String   // "Order placed" … "Delivered"
    var step: Int        // 0...3
    var etaEnd: Date     // countdown target
    var summary: String  // "Fresh Tomatoes + 2 more · ₹199"
  }
  var orderId: String
}

private struct IslandSteps: View {
  let step: Int
  var body: some View {
    HStack(spacing: 4) {
      ForEach(0..<4) { i in Capsule().fill(i <= step ? Color("neon") : Color.white.opacity(0.2)).frame(height: 4) }
    }
  }
}

private struct Countdown: View {
  let state: OneCityOrderAttributes.ContentState
  var body: some View {
    if state.step >= 3 || state.etaEnd <= .now {
      Text(state.step >= 3 ? "Done" : "Soon")
    } else {
      Text(timerInterval: Date.now...state.etaEnd, countsDown: true).monospacedDigit()
    }
  }
}

struct OrderLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: OneCityOrderAttributes.self) { context in
      // Lock screen / banner
      HStack(alignment: .center, spacing: 14) {
        Text("1").font(.system(size: 34, weight: .black)).foregroundStyle(Color("neon"))
        VStack(alignment: .leading, spacing: 5) {
          HStack {
            Text(context.state.status).font(.system(size: 17, weight: .heavy)).foregroundStyle(.white)
            Spacer()
            Countdown(state: context.state).font(.system(size: 15, weight: .bold)).foregroundStyle(Color("neon"))
          }
          Text(context.state.summary).font(.system(size: 12)).foregroundStyle(Color("mist")).lineLimit(1)
          IslandSteps(step: context.state.step)
        }
      }
      .padding(16)
      .activityBackgroundTint(Color("ink"))
      .activitySystemActionForegroundColor(Color("neon"))
      .widgetURL(URL(string: "onecity://order/\(context.attributes.orderId)"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 6) {
            Text("1").font(.system(size: 22, weight: .black)).foregroundStyle(Color("neon"))
            Text(context.state.status).font(.system(size: 15, weight: .heavy)).foregroundStyle(.white).lineLimit(1)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          Countdown(state: context.state).font(.system(size: 15, weight: .bold)).foregroundStyle(Color("neon"))
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 6) {
            IslandSteps(step: context.state.step)
            Text(context.state.summary).font(.system(size: 12)).foregroundStyle(Color("mist")).lineLimit(1)
          }
        }
      } compactLeading: {
        Text("1").font(.system(size: 15, weight: .black)).foregroundStyle(Color("neon"))
      } compactTrailing: {
        Countdown(state: context.state).font(.system(size: 13, weight: .bold)).foregroundStyle(Color("neon")).frame(maxWidth: 48)
      } minimal: {
        Text("1").font(.system(size: 13, weight: .black)).foregroundStyle(Color("neon"))
      }
      .widgetURL(URL(string: "onecity://order/\(context.attributes.orderId)"))
      .keylineTint(Color("neon"))
    }
  }
}
