// Home-screen widget (SwiftUI, WidgetKit). Reads the latest order that the app writes into the
// shared App Group (src/native/ios-extras.ts → updateOrderWidget). Built by @bacons/apple-targets
// during `npx expo prebuild`; edit the Swift here, never inside ios/.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'OneCityWidget',
  displayName: 'OneCity',
  deploymentTarget: '17.0',
  colors: {
    $widgetBackground: '#050605',
    $accent: '#B3F400',
    neon: '#B3F400',
    ink: '#050605',
    mist: '#9BA39B',
  },
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
