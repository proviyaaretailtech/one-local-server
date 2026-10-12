import ActivityKit
import ExpoModulesCore

// Must match OneCityOrderAttributes in targets/widget/OrderLiveActivity.swift.
struct OneCityOrderAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var status: String
    var step: Int
    var etaEnd: Date
    var summary: String
  }
  var orderId: String
}

public class OneCityLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OneCityLiveActivity")

    Function("areEnabled") { () -> Bool in
      if #available(iOS 16.2, *) { return ActivityAuthorizationInfo().areActivitiesEnabled }
      return false
    }

    // Starts the activity for an order, or returns the one already running for it.
    AsyncFunction("start") { (orderId: String, status: String, step: Int, etaEndMs: Double, summary: String) -> String? in
      guard #available(iOS 16.2, *), ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
      if let running = Activity<OneCityOrderAttributes>.activities.first(where: { $0.attributes.orderId == orderId }) {
        return running.id
      }
      let state = OneCityOrderAttributes.ContentState(status: status, step: step, etaEnd: Date(timeIntervalSince1970: etaEndMs / 1000), summary: summary)
      let activity = try Activity.request(attributes: OneCityOrderAttributes(orderId: orderId), content: .init(state: state, staleDate: nil), pushType: nil)
      return activity.id
    }

    // Moves the activity to a new step; the final step ends it (it lingers for 5 minutes).
    AsyncFunction("update") { (orderId: String, status: String, step: Int, etaEndMs: Double, summary: String) in
      guard #available(iOS 16.2, *) else { return }
      let state = OneCityOrderAttributes.ContentState(status: status, step: step, etaEnd: Date(timeIntervalSince1970: etaEndMs / 1000), summary: summary)
      for activity in Activity<OneCityOrderAttributes>.activities where activity.attributes.orderId == orderId {
        if step >= 3 {
          await activity.end(.init(state: state, staleDate: nil), dismissalPolicy: .after(.now.addingTimeInterval(5 * 60)))
        } else {
          await activity.update(.init(state: state, staleDate: nil))
        }
      }
    }
  }
}
