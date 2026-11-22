Pod::Spec.new do |spec|
  spec.name = 'CuddleLampAudio'
  spec.version = '0.1.0'
  spec.summary = 'Звуковой модуль cuddle-lamp для iOS'
  spec.homepage = 'https://localhost/cuddle-lamp'
  spec.license = { :type => 'Proprietary' }
  spec.author = 'cuddle-lamp'
  spec.source = { :path => '.' }
  spec.platform = :ios, '16.4'
  spec.default_subspec = 'Preview'
  spec.dependency 'React-Core'
  spec.dependency 'ReactCommon/turbomodule/core'

  spec.subspec 'Preview' do |preview|
    preview.source_files = 'ios/CuddleLamp/SoundEngineModuleProvider.mm'
  end

  spec.subspec 'Native' do |native|
    native.source_files = 'ios/CuddleLamp/SoundEngineModuleProvider.mm', 'cpp/*.{h,cpp}'
    native.vendored_frameworks = 'core/target/ios/SoundEngine.xcframework'
    native.frameworks = 'AVFoundation', 'MediaPlayer'
    native.dependency 'ReactCodegen'
    native.compiler_flags = get_folly_config[:compiler_flags]
    native.pod_target_xcconfig = {
      'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
      'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) CUDDLE_LAMP_NATIVE_AUDIO=1',
      'HEADER_SEARCH_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/cpp" "$(PODS_TARGET_SRCROOT)/core/crates/sound-ffi/include" "$(PODS_ROOT)/Headers/Public/ReactCodegen"'
    }
  end
end
