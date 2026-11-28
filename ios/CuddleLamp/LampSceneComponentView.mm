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
    UITouch *_dragTouch;
    CGPoint _dragStart;
    lamp::RelaxDrag _relaxDrag;
    CGVector _targetDragOffset, _dragVelocity;
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

- (BOOL)hasDragMotion {
    return _targetDragOffset.dx != 0 || _targetDragOffset.dy != 0
        || _relaxDrag.offset.dx != 0 || _relaxDrag.offset.dy != 0
        || _dragVelocity.dx != 0 || _dragVelocity.dy != 0
        || _relaxDrag.hasTearAnimation();
}

- (void)updateClock {
    BOOL dragging = [self hasDragMotion];
    if (!self.window || !_motionAllowed || (!_playing && !dragging)) {
        [_clock invalidate];
        _clock = nil;
        _lastFrame = 0;
        return;
    }
    if (!_clock) {
        _clock = [CADisplayLink displayLinkWithTarget:self selector:@selector(tick:)];
        [_clock addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    }
    float rate = dragging ? 60 : 30;
    if (_clock.preferredFrameRateRange.preferred != rate) {
        _clock.preferredFrameRateRange = CAFrameRateRangeMake(dragging ? 30 : 20, rate, rate);
    }
}

- (void)didMoveToWindow {
    [super didMoveToWindow];
    if (!self.window) {
        [self clearDrag];
    }
    [self updateClock];
}

- (void)clearDrag {
    _dragTouch = nil;
    _relaxDrag = {};
    _targetDragOffset = {};
    _dragVelocity = {};
}

- (BOOL)pointInside:(CGPoint)point withEvent:(UIEvent *)event {
    if (!self.userInteractionEnabled || ![super pointInside:point withEvent:event]) {
        return NO;
    }
    CGPoint scenePoint = lamp::getScenePoint(point, self.bounds.size);
    return lamp::isInsideRelaxFigure(scenePoint, _phase, _energy, _space);
}

- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
    if (_dragTouch || !self.userInteractionEnabled) return;
    _dragTouch = touches.anyObject;
    _dragStart = lamp::getScenePoint([_dragTouch locationInView:self], self.bounds.size);
    _relaxDrag.beginTearGrip(_dragStart, _phase, _energy, _space);
    if (![self hasDragMotion]) {
        _relaxDrag.anchor = _dragStart;
    }
}

- (void)touchesMoved:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
    if (!_dragTouch || ![touches containsObject:_dragTouch]) return;

    constexpr double maxOffset = 0.15;
    constexpr double initialResponse = 0.66;
    CGPoint point = lamp::getScenePoint([_dragTouch locationInView:self], self.bounds.size);
    double dx = point.x - _dragStart.x;
    double dy = point.y - _dragStart.y;
    double length = std::hypot(dx, dy);
    double resistedLength = maxOffset * std::tanh(initialResponse * length / maxOffset);
    double scale = length > 0 ? resistedLength / length : 0;
    _targetDragOffset = {dx * scale, dy * scale};
    [self updateClock];
}

- (void)endDragWithTouches:(NSSet<UITouch *> *)touches {
    if (!_dragTouch || ![touches containsObject:_dragTouch]) return;
    _dragTouch = nil;
    _targetDragOffset = {};
    _relaxDrag.releaseTears();
    [self updateClock];
}

- (void)touchesEnded:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
    [self endDragWithTouches:touches];
}

- (void)touchesCancelled:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
    [self endDragWithTouches:touches];
}

- (void)advanceDrag:(double)elapsed {
    if (_targetDragOffset.dx != 0 || _targetDragOffset.dy != 0) {
        double step = -std::expm1(-elapsed / 0.055);
        _relaxDrag.anchor.x += (_dragStart.x - _relaxDrag.anchor.x) * step;
        _relaxDrag.anchor.y += (_dragStart.y - _relaxDrag.anchor.y) * step;
    }
    double returnFrequency = _relaxDrag.hasVisibleTears() ? 7.5 : 10.5;
    double frequency = _dragTouch ? 24.0 : returnFrequency;
    lamp::advanceSpringAxis(_relaxDrag.offset.dx, _dragVelocity.dx, _targetDragOffset.dx, frequency, elapsed);
    lamp::advanceSpringAxis(_relaxDrag.offset.dy, _dragVelocity.dy, _targetDragOffset.dy, frequency, elapsed);
    if (!_dragTouch && std::hypot(_relaxDrag.offset.dx, _relaxDrag.offset.dy) < 0.0003
        && std::hypot(_dragVelocity.dx, _dragVelocity.dy) < 0.003) {
        _relaxDrag.offset = {};
        _dragVelocity = {};
    }
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
    self.userInteractionEnabled = scene == lamp::Scene::relax && _motionAllowed;
    if (changed || !self.userInteractionEnabled) {
        redraw |= _relaxDrag.offset.dx != 0 || _relaxDrag.offset.dy != 0 || _relaxDrag.hasVisibleTears();
        [self clearDrag];
    }
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
    if (_playing) {
        double speed = _scene == lamp::Scene::sleep ? 1.0 / 30 : 1.0 / 19;
        _phase = std::fmod(_phase + elapsed * 2 * M_PI * speed, 2 * M_PI);
    }
    if (_scene == lamp::Scene::relax && [self hasDragMotion]) {
        [self advanceDrag:elapsed];
        _relaxDrag.advanceTears(elapsed, _dragTouch != nil, _phase, _energy, _space);
    }
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
        lamp::drawScene(context, self.bounds.size, _scene, _phase, _energy, _space, _relaxDrag);
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
