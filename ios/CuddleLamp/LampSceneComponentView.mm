#import <QuartzCore/QuartzCore.h>
#import <React/RCTViewComponentView.h>
#import <react/renderer/components/CuddleLampSpecs/ComponentDescriptors.h>

#import "SceneDrawing.h"
#import "FocusGallery.h"

#include <algorithm>
#include <cmath>

using namespace facebook::react;

@interface LampSceneSurface : UIView
- (void)applyProps:(const LampSceneViewProps &)props;
@end

@implementation LampSceneSurface {
    lamp::Scene _scene;
    CADisplayLink *_clock;
    CGLayerRef _galleryBackdrop;
    CGFloat _backdropScale;
    int _localMinute;
    lamp::gallery::Glints _glints, _targetGlints;
    CFTimeInterval _lastFrame;
    double _phase, _energy, _targetEnergy, _space;
    BOOL _playing, _motionAllowed, _configured;
}

- (instancetype)initWithFrame:(CGRect)frame {
    if ((self = [super initWithFrame:frame])) {
        self.opaque = NO;
        self.contentMode = UIViewContentModeRedraw;
        self.userInteractionEnabled = NO;
    }
    return self;
}

- (void)clearGalleryBackdrop {
    if (_galleryBackdrop) {
        CGLayerRelease(_galleryBackdrop);
        _galleryBackdrop = nullptr;
    }
}

- (void)dealloc {
    if (_galleryBackdrop) CGLayerRelease(_galleryBackdrop);
}

- (void)layoutSubviews {
    [super layoutSubviews];
    // Ограничиваем стоимость полноэкранной прозрачной поверхности на Retina.
    CGFloat longest = MAX(self.bounds.size.width, self.bounds.size.height);
    if (longest > 0 && self.window) {
        self.contentScaleFactor = MIN(self.window.screen.scale, 1200 / longest);
    }
}

- (void)updateClock {
    BOOL active = self.window && _playing && _motionAllowed;
    if (active && !_clock) {
        _clock = [CADisplayLink displayLinkWithTarget:self selector:@selector(tick:)];
        _clock.preferredFrameRateRange = CAFrameRateRangeMake(20, 30, 30);
        [_clock addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    } else if (!active && _clock) {
        [_clock invalidate];
        _clock = nil;
        _lastFrame = 0;
    }
}

- (void)didMoveToWindow {
    [super didMoveToWindow];
    [self updateClock];
}

- (void)applyProps:(const LampSceneViewProps &)props {
    lamp::Scene scene = props.scene == "sleep" ? lamp::Scene::sleep : lamp::Scene::relax;
    if (props.scene == "focus") scene = lamp::Scene::gallery;
    BOOL changed = scene != _scene;
    BOOL lightingChanged = scene == lamp::Scene::gallery && props.localMinute != _localMinute;
    if (changed || lightingChanged) [self clearGalleryBackdrop];
    _localMinute = props.localMinute;
    double space = std::clamp<double>(props.space, 0, 1);
    BOOL redraw = !_configured || changed || lightingChanged || space != _space;
    if (!props.motionAllowed) {
        [self.layer removeAnimationForKey:@"sceneChange"];
    } else if (_configured && changed && self.window) {
        CATransition *transition = [CATransition animation];
        transition.type = kCATransitionFade;
        transition.duration = 1.05;
        [self.layer addAnimation:transition forKey:@"sceneChange"];
    }
    _configured = YES;
    _scene = scene;
    _space = space;
    _playing = props.playing;
    _motionAllowed = props.motionAllowed;
    _targetGlints.fill(0);
    if (scene == lamp::Scene::gallery && _playing && _motionAllowed) {
        for (const auto &bell : props.bells) {
            // В «Фокусе» колокольчики занимают две октавы над ре первой октавы.
            double pitch = std::clamp((bell.midi - 74) / 21.0, 0.0, 1.0);
            size_t rib = 1 + std::lround(pitch * (_glints.size() - 2));
            double strength = std::pow(std::clamp<double>(bell.level / 0.07, 0, 1), 0.24);
            _targetGlints[rib] = std::max(_targetGlints[rib], strength);
        }
    }
    if (changed || !_playing || !_motionAllowed) {
        redraw |= _glints != lamp::gallery::Glints{};
        _glints.fill(0);
    }
    const double rms = std::max<double>(0.0, props.rms);
    _targetEnergy = _playing && _motionAllowed ? std::min(1.0, std::sqrt(3.0 * rms)) : 0;
    if (!_playing || !_motionAllowed) {
        redraw |= _energy != 0;
        _energy = 0;
    }
    if (redraw) [self setNeedsDisplay];
    [self updateClock];
}

- (void)tick:(CADisplayLink *)clock {
    double elapsed = _lastFrame ? std::min(clock.timestamp - _lastFrame, 0.08) : 0;
    _lastFrame = clock.timestamp;
    double response = _scene == lamp::Scene::gallery ? 2.0 : (_targetEnergy > _energy ? 0.65 : 1.6);
    _energy += (_targetEnergy - _energy) * -std::expm1(-elapsed / response);
    if (_targetEnergy == 0 && _energy < 0.0001) _energy = 0;
    if (_scene == lamp::Scene::gallery) {
        for (size_t rib = 0; rib < _glints.size(); ++rib) {
            _glints[rib] += (_targetGlints[rib] - _glints[rib]) * -std::expm1(-elapsed / 0.10);
        }
        [self setNeedsDisplay];
        return;
    }
    double speed = _scene == lamp::Scene::sleep ? 1.0 / 30 : 1.0 / 19;
    _phase = std::fmod(_phase + elapsed * 2 * M_PI * speed, 2 * M_PI);
    [self setNeedsDisplay];
    [self updateClock];
}

- (void)drawRect:(CGRect)rect {
    CGContextRef context = UIGraphicsGetCurrentContext();
    if (!context || CGRectIsEmpty(self.bounds)) return;
    if (_scene == lamp::Scene::gallery) {
        CGSize size = self.bounds.size;
        if (!_galleryBackdrop || !CGSizeEqualToSize(CGLayerGetSize(_galleryBackdrop), size)
            || _backdropScale != self.contentScaleFactor) {
            [self clearGalleryBackdrop];
            _galleryBackdrop = CGLayerCreateWithContext(context, size, nullptr);
            _backdropScale = self.contentScaleFactor;
            if (_galleryBackdrop) {
                lamp::gallery::drawArchitecture(CGLayerGetContext(_galleryBackdrop), size, _localMinute);
            }
        }
        if (_galleryBackdrop) {
            CGContextDrawLayerAtPoint(context, CGPointZero, _galleryBackdrop);
        } else {
            lamp::gallery::drawArchitecture(context, size, _localMinute);
        }
        lamp::gallery::drawReflections(context, size, _localMinute, _energy, _glints);
    } else {
        lamp::drawScene(context, self.bounds.size, _scene, _phase, _energy, _space);
    }
}
@end

@interface LampSceneComponentView : RCTViewComponentView
@end

@implementation LampSceneComponentView

+ (ComponentDescriptorProvider)componentDescriptorProvider {
    return concreteComponentDescriptorProvider<LampSceneViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame {
    if ((self = [super initWithFrame:frame])) {
        _props = LampSceneViewShadowNode::defaultSharedProps();
        self.contentView = [[LampSceneSurface alloc] initWithFrame:self.bounds];
    }
    return self;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps {
    [(LampSceneSurface *)self.contentView applyProps:*std::static_pointer_cast<const LampSceneViewProps>(props)];
    [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle {
    [super prepareForRecycle];
    _props = LampSceneViewShadowNode::defaultSharedProps();
    self.contentView = [[LampSceneSurface alloc] initWithFrame:self.bounds];
}
@end
