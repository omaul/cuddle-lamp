#import <ReactCommon/RCTTurboModule.h>

#if CUDDLE_LAMP_NATIVE_AUDIO
#import <AVFoundation/AVFoundation.h>
#import <MediaPlayer/MediaPlayer.h>
#include "SoundEngineModule.h"
#include "SoundEngineControl.h"
#include <atomic>
#include <stdexcept>

using facebook::react::SoundEngineControl;
using facebook::react::SoundEngineModule;

@interface CuddleLampAudioOutput : NSObject
- (void)startWhenAvailable;
- (BOOL)startOutput;
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
  if (!_engine && ![self startOutput]) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [self startWhenAvailable];
    });
  }
}

- (BOOL)startOutput
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *error = nil;
  if (![session setCategory:AVAudioSessionCategoryPlayback error:&error] ||
      ![session setActive:YES error:&error]) {
    return NO;
  }

  _audio = [[AVAudioEngine alloc] init];
  double sampleRate = [_audio.outputNode inputFormatForBus:0].sampleRate;
  _engine = sound_engine_create(static_cast<float>(sampleRate));
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
  if (![_audio startAndReturnError:&error]) {
    [_audio stop];
    _audio = nil;
    sound_engine_destroy(_engine);
    _engine = nullptr;
    return NO;
  }
  SoundEngineControl::shared().attach(_engine);
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

- (void)prepareTransport:(BOOL)playing
{
  _resumeAfterInterruption = false;
  if (!playing) {
    return;
  }
  if (_isInterrupted) {
    throw std::runtime_error("Аудиосессия прервана");
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self->_isInterrupted && !self->_audio.isRunning &&
        [[AVAudioSession sharedInstance] setActive:YES error:nullptr]) {
      [self->_audio startAndReturnError:nullptr];
    }
  });
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
    return;
  }

  auto options = [notification.userInfo[AVAudioSessionInterruptionOptionKey] unsignedIntegerValue];
  _isInterrupted = NO;
  const BOOL shouldResume = _resumeAfterInterruption.exchange(false) &&
      (options & AVAudioSessionInterruptionOptionShouldResume);
  if ([[AVAudioSession sharedInstance] setActive:YES error:nullptr] &&
      (_audio.isRunning || [_audio startAndReturnError:nullptr]) && shouldResume) {
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
    if (!self->_audio.isRunning && !self->_isInterrupted) {
      [self->_audio startAndReturnError:nullptr];
    }
  });
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  [_nowPlayingTimer invalidate];
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
  return nullptr;
#endif
}
@end
