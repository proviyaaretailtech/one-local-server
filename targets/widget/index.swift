import SwiftUI
import WidgetKit

@main
struct OneCityWidgets: WidgetBundle {
  var body: some Widget {
    OrderWidget()        // home-screen widget
    OrderLiveActivity()  // lock screen + Dynamic Island
  }
}
