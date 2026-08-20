Pod::Spec.new do |s|
  s.name           = 'AppAttest'
  s.version        = '1.0.0'
  s.summary        = 'DCAppAttestService bridge for Venue Wrangler'
  s.description    = 'Generates App Attest keys, attestations, and per-request assertions.'
  s.author         = 'Loungeability LLC'
  s.homepage       = 'https://venuewrangler.com'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
