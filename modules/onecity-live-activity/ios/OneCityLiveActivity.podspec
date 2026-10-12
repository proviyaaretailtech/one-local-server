Pod::Spec.new do |s|
  s.name           = 'OneCityLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Starts and updates the OneCity order Live Activity'
  s.description    = 'Starts, updates and ends the OneCity order Live Activity (lock screen and Dynamic Island).'
  s.author         = 'OneCity'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift}"
end
