#import <ReactCommon/RCTTurboModule.h>

#if CUDDLE_LAMP_NATIVE_AUDIO
#import <AVFoundation/AVFoundation.h>
#import <MediaPlayer/MediaPlayer.h>
#include "SoundEngineModule.h"
#include "SoundEngineControl.h"
#include <algorithm>
#include <atomic>
#include <stdexcept>

using facebook::react::SoundEngineControl;
using facebook::react::SoundEngineModule;

@interface CuddleLampAudioOutput : NSObject
- (void)startWhenAvailable;
- (BOOL)prepareOutput;
- (void)prepareTransport:(BOOL)playing;
- (MPRemoteCommandHandlerStatus)handleRemotePlaying:(BOOL)playing;
- (MPRemoteCommandHandlerStatus)toggleRemotePlayback;
+ (MPRemoteCommandHandlerStatus)setSystemPlaying:(BOOL)playing;
@end

@implementation CuddleLampAudioOutput {
  AVAudioEngine *_audio;
  SoundEngine *_engine;
  id _remotePlay;
  id _remotePause;
  id _remoteToggle;
  NSTimer *_nowPlayingTimer;
  NSTimer *_idleTimer;
  float _sampleRate;
  int32_t _lastStatus;
  NSString *_lastTitle;
  std::atomic_bool _isInterrupted;
  std::atomic_bool _resumeAfterInterruption;
}

- (instancetype)init
{
  self = [super init];
  if (!self) {
    return nil;
  }
  _isInterrupted = false;
  _resumeAfterInterruption = false;
  return self;
}

- (void)startWhenAvailable
{
  if (!_engine && ![self prepareOutput]) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [self startWhenAvailable];
    });
  }
}

- (BOOL)prepareOutput
{
  _audio = [[AVAudioEngine alloc] init];
  double sampleRate = [_audio.outputNode inputFormatForBus:0].sampleRate;
  _sampleRate = static_cast<float>(sampleRate);
  _engine = sound_engine_create(_sampleRate);
  if (!_engine) {
    _audio = nil;
    return NO;
  }

  AVAudioFormat *format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:sampleRate channels:2];
  SoundEngine *engine = _engine;
  AVAudioSourceNode *source = [[AVAudioSourceNode alloc]
      initWithFormat:format
      renderBlock:^OSStatus(BOOL *isSilence, const AudioTimeStamp *, AVAudioFrameCount frames, AudioBufferList *buffers) {
        if (buffers->mNumberBuffers != 2 ||
            !buffers->mBuffers[0].mData || !buffers->mBuffers[1].mData) {
          *isSilence = YES;
          return noErr;
        }
        *isSilence = NO;
        sound_engine_render(
            engine, static_cast<float *>(buffers->mBuffers[0].mData),
            static_cast<float *>(buffers->mBuffers[1].mData), frames);
        return noErr;
      }];
  [_audio attachNode:source];
  [_audio connect:source to:_audio.mainMixerNode format:format];
  SoundEngineControl::shared().attach(_engine);
  __weak CuddleLampAudioOutput *output = self;
  _idleTimer = [NSTimer timerWithTimeInterval:0.03 repeats:YES block:^(NSTimer *) {
    [output processIdleCommands];
  }];
  [[NSRunLoop mainRunLoop] addTimer:_idleTimer forMode:NSRunLoopCommonModes];
  [self installSystemControls];
  return YES;
}

- (void)installSystemControls
{
  MPRemoteCommandCenter *commands = [MPRemoteCommandCenter sharedCommandCenter];
  __weak CuddleLampAudioOutput *output = self;
  _remotePlay = [commands.playCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *) {
    CuddleLampAudioOutput *target = output;
    return target ? [target handleRemotePlaying:YES] : MPRemoteCommandHandlerStatusCommandFailed;
  }];
  _remotePause = [commands.pauseCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *) {
    CuddleLampAudioOutput *target = output;
    return target ? [target handleRemotePlaying:NO] : MPRemoteCommandHandlerStatusCommandFailed;
  }];
  _remoteToggle = [commands.togglePlayPauseCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *) {
    CuddleLampAudioOutput *target = output;
    return target ? [target toggleRemotePlayback] : MPRemoteCommandHandlerStatusCommandFailed;
  }];
  [MPNowPlayingInfoCenter defaultCenter].nowPlayingInfo = @{
    MPMediaItemPropertyTitle: @"cuddle-lamp",
    MPNowPlayingInfoPropertyIsLiveStream: @YES,
  };

  NSNotificationCenter *notifications = [NSNotificationCenter defaultCenter];
  [notifications addObserver:self selector:@selector(handleInterruption:)
      name:AVAudioSessionInterruptionNotification object:nil];
  [notifications addObserver:self selector:@selector(handleRouteChange:)
      name:AVAudioSessionRouteChangeNotification object:nil];
  [notifications addObserver:self selector:@selector(handleConfigurationChange:)
      name:AVAudioEngineConfigurationChangeNotification object:_audio];
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_nowPlayingTimer = [NSTimer scheduledTimerWithTimeInterval:0.5 repeats:YES block:^(NSTimer *) {
      [output updateNowPlaying];
    }];
  });
}

- (void)processIdleCommands
{
  if (_audio.isRunning) {
    return;
  }
  // До Play и во время прерывания команды обрабатывает главный поток.
  // При работающем выводе движок принадлежит аудиоколбэку.
  [_audio stop];
  if (sound_engine_get_state(_engine).status != SOUND_ENGINE_STATUS_STOPPING) {
    sound_engine_render(_engine, nullptr, nullptr, 0);
    return;
  }
  float left[1024], right[1024];
  const auto frames = static_cast<uint32_t>(std::min(1024.0f, _sampleRate * 0.03f));
  sound_engine_render(_engine, left, right, frames);
}

- (BOOL)activateOutput
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  if (!_engine || _isInterrupted) {
    return NO;
  }
  if (_audio.isRunning) {
    return YES;
  }
  if (![session setCategory:AVAudioSessionCategoryPlayback error:nullptr] ||
      ![session setActive:YES error:nullptr]) {
    return NO;
  }
  if ([_audio startAndReturnError:nullptr]) {
    return YES;
  }
  [session setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:nullptr];
  return NO;
}

- (void)prepareTransport:(BOOL)playing
{
  _resumeAfterInterruption = false;
  if (!playing) {
    return;
  }
  __block BOOL started = NO;
  void (^activate)(void) = ^{
    started = [self activateOutput];
  };
  if ([NSThread isMainThread]) {
    activate();
  } else {
    dispatch_sync(dispatch_get_main_queue(), activate);
  }
  if (!started) {
    throw std::runtime_error("Не удалось запустить аудиовывод");
  }
}

- (MPRemoteCommandHandlerStatus)handleRemotePlaying:(BOOL)playing
{
  if (sound_engine_get_state(_engine).status == SOUND_ENGINE_STATUS_IDLE) {
    return MPRemoteCommandHandlerStatusNoSuchContent;
  }
  try {
    [self prepareTransport:playing];
    return [CuddleLampAudioOutput setSystemPlaying:playing];
  } catch (...) {
    return MPRemoteCommandHandlerStatusCommandFailed;
  }
}

- (MPRemoteCommandHandlerStatus)toggleRemotePlayback
{
  const auto status = sound_engine_get_state(_engine).status;
  const BOOL isAudible = status == SOUND_ENGINE_STATUS_PLAYING || status == SOUND_ENGINE_STATUS_STOPPING;
  return [self handleRemotePlaying:!isAudible];
}

- (void)updateNowPlaying
{
  try {
    const auto snapshot = SoundEngineControl::shared().readSnapshot();
    NSData *data = [NSData dataWithBytes:snapshot.data() length:snapshot.size()];
    NSDictionary *state = [NSJSONSerialization JSONObjectWithData:data options:0 error:nullptr];
    id scene = state[@"scene"];
    NSString *title = [scene isKindOfClass:[NSDictionary class]] ? scene[@"name"] : @"cuddle-lamp";
    int32_t status = [state[@"status"] intValue];
    if (status == _lastStatus && [title isEqualToString:_lastTitle]) {
      return;
    }
    _lastStatus = status;
    _lastTitle = title;
    BOOL isAudible = status == SOUND_ENGINE_STATUS_PLAYING || status == SOUND_ENGINE_STATUS_STOPPING;
    [MPNowPlayingInfoCenter defaultCenter].nowPlayingInfo = @{
      MPMediaItemPropertyTitle: title,
      MPNowPlayingInfoPropertyIsLiveStream: @YES,
      MPNowPlayingInfoPropertyPlaybackRate: @(isAudible ? 1.0 : 0.0),
    };
  } catch (...) {
    [MPNowPlayingInfoCenter defaultCenter].nowPlayingInfo = nil;
  }
}

+ (MPRemoteCommandHandlerStatus)setSystemPlaying:(BOOL)playing
{
  try {
    SoundEngineControl::shared().setPlaying(playing);
    return MPRemoteCommandHandlerStatusSuccess;
  } catch (...) {
    return MPRemoteCommandHandlerStatusCommandFailed;
  }
}

- (void)handleInterruption:(NSNotification *)notification
{
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{ [self handleInterruption:notification]; });
    return;
  }
  auto type = [notification.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue];
  if (type == AVAudioSessionInterruptionTypeBegan) {
    _isInterrupted = YES;
    if (sound_engine_get_state(_engine).status == SOUND_ENGINE_STATUS_PLAYING) {
      _resumeAfterInterruption = true;
    }
    [CuddleLampAudioOutput setSystemPlaying:NO];
    [_audio stop];
    return;
  }

  auto options = [notification.userInfo[AVAudioSessionInterruptionOptionKey] unsignedIntegerValue];
  _isInterrupted = NO;
  const BOOL shouldResume = _resumeAfterInterruption.exchange(false) &&
      (options & AVAudioSessionInterruptionOptionShouldResume);
  if (shouldResume && [self activateOutput]) {
    [CuddleLampAudioOutput setSystemPlaying:YES];
  }
}

- (void)handleRouteChange:(NSNotification *)notification
{
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{ [self handleRouteChange:notification]; });
    return;
  }
  auto reason = [notification.userInfo[AVAudioSessionRouteChangeReasonKey] unsignedIntegerValue];
  if (reason == AVAudioSessionRouteChangeReasonOldDeviceUnavailable) {
    _resumeAfterInterruption = NO;
    [CuddleLampAudioOutput setSystemPlaying:NO];
  }
}

- (void)handleConfigurationChange:(NSNotification *)notification
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self->_audio.isRunning &&
        sound_engine_get_state(self->_engine).status == SOUND_ENGINE_STATUS_PLAYING) {
      [self activateOutput];
    }
  });
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  [_nowPlayingTimer invalidate];
  [_idleTimer invalidate];
  MPRemoteCommandCenter *commands = [MPRemoteCommandCenter sharedCommandCenter];
  if (_remotePlay) {
    [commands.playCommand removeTarget:_remotePlay];
  }
  if (_remotePause) {
    [commands.pauseCommand removeTarget:_remotePause];
  }
  if (_remoteToggle) {
    [commands.togglePlayPauseCommand removeTarget:_remoteToggle];
  }
  [_audio stop];
  if (_engine) {
    SoundEngineControl::shared().attach(nullptr);
    sound_engine_destroy(_engine);
  }
}

@end
#endif

@interface SoundEngineModuleProvider : NSObject <RCTModuleProvider>
@end

@implementation SoundEngineModuleProvider
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
#if CUDDLE_LAMP_NATIVE_AUDIO
  static CuddleLampAudioOutput *output;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    output = [[CuddleLampAudioOutput alloc] init];
    dispatch_async(dispatch_get_main_queue(), ^{
      [output startWhenAvailable];
    });
  });
  return std::make_shared<SoundEngineModule>(params.jsInvoker, [](bool playing) {
    [output prepareTransport:playing];
  });
#else
  // React Native требует объект от зарегистрированного поставщика даже в тестовой сборке.
  return std::make_shared<facebook::react::TurboModule>(params.moduleName, params.jsInvoker);
#endif
}
@end
