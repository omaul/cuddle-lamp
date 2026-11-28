#include "SceneDrawing.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace lamp {
namespace {

constexpr double tau = 2 * M_PI;
constexpr int contourSteps = 96;
constexpr int lastRing = RelaxDrag::contourCount - 1;
constexpr int firstTearRing = lastRing - 8;
constexpr double dragRadius = 0.23;
constexpr int contourSectionSteps = 8;
constexpr double tearThreshold = 0.066;
constexpr double edgeGripDistance = 0.105;

double getSceneScale(CGSize size) {
    return std::min({size.width * 1.06, size.height * 0.56, 580.0});
}

CGPoint getSceneCenter(CGSize size) {
    return {size.width / 2, size.height * 0.42};
}

double nextUnit(uint32_t &seed) {
    seed = 1664525u * seed + 1013904223u;
    return double(seed) / 4294967296.0;
}

CGPoint getContourPoint(double angle, double fraction, double phase, double energy, double space) {
    double radius = 0.084 + 0.32 * fraction;
    double turn = phase + 3 * fraction;
    double shell = radius * (1 + (0.08 + 0.05 * space) * std::sin(3 * angle + turn)
                               + 0.05 * std::cos(2 * angle - 5 * fraction + phase));
    double x = shell * std::cos(angle) - 0.066 * std::cos(M_PI * fraction + phase);
    return {x, shell * std::sin(angle) * (0.79 + 0.04 * energy)
               - 0.028 * std::sin(tau * fraction + phase) + x * 0.15};
}

double getDragWeight(CGPoint point, CGPoint anchor) {
    double dx = point.x - anchor.x;
    double dy = point.y - anchor.y;
    double weight = std::max(0.0, 1 - (dx * dx + dy * dy) / (dragRadius * dragRadius));
    return weight * weight;
}

double getOutwardPull(CGPoint start, CGPoint end, const RelaxDrag &drag) {
    CGPoint middle{(start.x + end.x) / 2, (start.y + end.y) / 2};
    double weight = getDragWeight(middle, drag.anchor);
    if (weight == 0) return 0;
    // Нормаль исходного контура определяет, тянется ли этот участок наружу.
    double dx = end.x - start.x;
    double dy = end.y - start.y;
    double length = std::hypot(dx, dy);
    return length > 0 ? (drag.offset.dx * dy - drag.offset.dy * dx) / length * weight : 0;
}

struct TearSite {
    int step = -1;
    double excessPull = 0;
};

struct LooseEnd {
    double length = 0;
    double recoil = 0;
};

struct TearShape {
    double preferredOffset = 0;
    LooseEnd first;
    LooseEnd second;
};

TearShape getTearShape(int ring) {
    // Профиль закреплён за нитью, чтобы срез сохранял форму между кадрами.
    uint32_t seed = (uint32_t(ring) + 1) * 0x9e3779b9u;
    seed ^= seed >> 16;
    return {
        std::lerp(-3.5, 3.5, nextUnit(seed)),
        {std::lerp(6.2, 11.8, nextUnit(seed)), std::lerp(1.6, 3.3, nextUnit(seed))},
        {std::lerp(6.2, 11.8, nextUnit(seed)), std::lerp(1.6, 3.3, nextUnit(seed))},
    };
}

TearSite findTearSite(int ring, double phase, double energy, double space, const RelaxDrag &drag) {
    constexpr int searchRadius = 6;
    int firstStep = drag.tearEdgeStep - searchRadius;
    int lastStep = drag.tearEdgeStep + searchRadius;
    double fraction = double(ring) / lastRing;
    double limit = tearThreshold + (ring % 3) * 0.004;
    double preferredStep = drag.tearEdgeStep + getTearShape(ring).preferredOffset;
    double bestScore = 0;
    TearSite site;
    CGPoint start = getContourPoint(tau * firstStep / contourSteps, fraction, phase, energy, space);
    for (int step = firstStep; step <= lastStep; ++step) {
        CGPoint end = getContourPoint(tau * (step + 1) / contourSteps, fraction, phase, energy, space);
        double excessPull = getOutwardPull(start, end, drag) - limit;
        double score = excessPull - 0.0075 * std::abs(step - preferredStep);
        if (excessPull > 0 && (site.step < 0 || score > bestScore)) {
            site = {(step + contourSteps) % contourSteps, excessPull};
            bestScore = score;
        }
        start = end;
    }
    return site;
}

double easeTear(double progress) {
    return progress * progress * (3 - 2 * progress);
}

CGPoint getLooseEndPoint(CGPoint point, CGPoint root, CGVector direction, double amount, double sway) {
    double dx = point.x - root.x;
    double dy = point.y - root.y;
    double length = std::hypot(dx, dy);
    // Свободный конец вытягивается по направлению рывка и колеблется поперёк него.
    double along = 0.94 * length;
    double across = 0.35 * (dy * direction.dx - dx * direction.dy) + 0.11 * length * sway;
    CGPoint trailing{root.x + direction.dx * along - direction.dy * across,
                     root.y + direction.dy * along + direction.dx * across};
    return {std::lerp(point.x, trailing.x, amount), std::lerp(point.y, trailing.y, amount)};
}

void addTornContourSection(CGContextRef context, const CGPoint *points, int lastIntactStep,
                           CGPoint firstEnd, CGPoint secondEnd) {
    CGContextMoveToPoint(context, points[0].x, points[0].y);
    for (int index = 1; index <= lastIntactStep; ++index) {
        CGContextAddLineToPoint(context, points[index].x, points[index].y);
    }
    CGContextAddLineToPoint(context, firstEnd.x, firstEnd.y);
    CGContextMoveToPoint(context, secondEnd.x, secondEnd.y);
    for (int index = lastIntactStep + 1; index <= contourSectionSteps; ++index) {
        CGContextAddLineToPoint(context, points[index].x, points[index].y);
    }
}

void drawContours(CGContextRef context, double phase, double energy, double space, const RelaxDrag &drag) {
    std::array<CGPoint, contourSteps + 1> points;
    bool isDeformed = drag.offset.dx != 0 || drag.offset.dy != 0;
    CGContextSetLineJoin(context, kCGLineJoinRound);
    for (int ring = 0; ring <= lastRing; ++ring) {
        double fraction = double(ring) / lastRing;
        const RelaxTear &tear = drag.tears[ring];
        auto getPulledPoint = [&](double step, double recoil) {
            CGPoint point = getContourPoint(tau * step / contourSteps, fraction, phase, energy, space);
            if (isDeformed) {
                double weight = getDragWeight(point, drag.anchor) * (1 - 0.28 * recoil);
                point.x += drag.offset.dx * weight;
                point.y += drag.offset.dy * weight;
            }
            point.x -= tear.direction.dx * 0.018 * recoil;
            point.y -= tear.direction.dy * 0.018 * recoil;
            return point;
        };
        TearShape shape = tear.opening > 0 ? getTearShape(ring) : TearShape{};
        double flex = 0.86 * tear.opening * tear.flex;
        CGPoint firstRoot{}, secondRoot{};
        double firstSway = 0, secondSway = 0;
        if (flex > 0) {
            firstRoot = getPulledPoint(tear.step - shape.first.length, 0);
            secondRoot = getPulledPoint(tear.step + shape.second.length, 0);
            double swayPhase = 3.2 * tear.motionTime + 0.37 * ring;
            firstSway = std::sin(swayPhase);
            secondSway = std::sin(swayPhase + 1.1);
        }
        auto getPoint = [&](double step, double distanceFromTear) {
            if (tear.opening == 0) return getPulledPoint(step, 0);
            bool isFirstEnd = std::signbit(distanceFromTear);
            const LooseEnd &end = isFirstEnd ? shape.first : shape.second;
            double distance = std::abs(distanceFromTear);
            double recoil = tear.opening * (1 - easeTear(std::min(1.0, distance / (end.length + 2))));
            // Концы сдвигаются вдоль линии и увлекают за собой соседние точки.
            step += std::copysign(end.recoil * recoil, distanceFromTear);
            CGPoint point = getPulledPoint(step, recoil);
            if (flex > 0 && distance < end.length) {
                CGPoint root = isFirstEnd ? firstRoot : secondRoot;
                double sway = isFirstEnd ? firstSway : secondSway;
                double weight = 1 - easeTear(distance / end.length);
                point = getLooseEndPoint(point, root, tear.direction, flex * weight, sway);
            }
            return point;
        };
        for (int step = 0; step <= contourSteps; ++step) {
            double distance = tear.opening > 0 ? std::remainder(step - tear.step, contourSteps) : 0;
            points[step] = getPoint(step, distance);
        }
        CGContextSetLineWidth(context, ring % 7 == 0 ? 0.0026 : 0.0018);
        for (int step = 0; step < contourSteps; step += contourSectionSteps) {
            double angle = tau * (step + contourSectionSteps / 2) / contourSteps;
            double light = std::pow(0.5 + 0.5 * std::cos(angle - 6 * fraction + phase), 2);
            CGContextSetRGBStrokeColor(context, 0.68 + 0.32 * light, 0.46 + 0.33 * light, 0.59, 0.30 + 0.55 * light);
            if (tear.opening > 0 && tear.step > step && tear.step < step + contourSectionSteps) {
                addTornContourSection(context, points.data() + step, int(tear.step) - step,
                                      getPoint(tear.step, -0.0), getPoint(tear.step, 0.0));
            } else {
                CGContextAddLines(context, points.data() + step, contourSectionSteps + 1);
            }
            CGContextStrokePath(context);
        }
    }
}

void drawNight(CGContextRef context, double phase, double energy, double space) {
    uint32_t seed = 337;
    for (int star = 0; star < 82; ++star) {
        double x = nextUnit(seed) - 0.5;
        double y = -0.36 + 0.62 * nextUnit(seed);
        double radius = 0.0009 + 0.0016 * nextUnit(seed);
        CGContextSetRGBFillColor(context, 0.76, 0.84, 0.97, 0.4 + 0.22 * std::sin(phase + star));
        CGContextFillEllipseInRect(context, CGRectMake(x - radius, y - radius, 2 * radius, 2 * radius));
    }
    constexpr int steps = 80;
    std::array<CGPoint, steps + 1> points;
    for (int band = 1; band <= 2; ++band) {
        for (int strand = 0; strand < 32; ++strand) {
            double fraction = strand / 31.0;
            double drape = std::pow(fraction, 1.6) * (0.8 + 0.3 * space + 0.12 * energy);
            for (int step = 0; step <= steps; ++step) {
                double along = double(step) / steps;
                double bend = tau * along + band * 1.1 + 0.4 * std::sin(phase + fraction);
                double x = along - 0.5 + 0.026 * std::sin(1.7 * bend + fraction);
                double y = 0.048 * std::sin(2 * bend + 0.9 * fraction) + 0.098 * std::cos(bend + 0.45 * fraction);
                double offset = (along - 0.59) / 0.21;
                points[step] = {x, y + drape * (0.035 + 0.16 * std::exp(-offset * offset)) + 0.038 * band - 0.078};
            }
            CGContextSetLineWidth(context, 0.0018);
            for (int step = 0; step < steps; step += 8) {
                double along = double(step + 4) / steps;
                double tint = band == 1 ? along : 1 - along;
                double alpha = 0.55 * std::sin(M_PI * along) * (1 - 0.85 * fraction);
                CGContextSetRGBStrokeColor(context, 0.59 - 0.07 * tint, 0.49 + 0.40 * tint, 0.84, alpha);
                CGContextAddLines(context, points.data() + step, 9);
                CGContextStrokePath(context);
            }
        }
    }
}
}

// Сохраняем скорость контура при смене цели, в том числе в момент отпускания пальца.
void advanceSpringAxis(double &position, double &velocity, double target, double frequency, double elapsed) {
    double error = position - target;
    double rate = velocity + frequency * error;
    double decay = std::exp(-frequency * elapsed);
    position = target + (error + rate * elapsed) * decay;
    velocity = (velocity - frequency * rate * elapsed) * decay;
}

bool RelaxDrag::hasTearAnimation() const {
    return std::any_of(tears.begin(), tears.end(), [](const RelaxTear &tear) {
        return tear.isHeld || tear.opening > 0 || tear.strain > 0;
    });
}

bool RelaxDrag::hasVisibleTears() const {
    return std::any_of(tears.begin(), tears.end(), [](const RelaxTear &tear) { return tear.opening > 0; });
}

void RelaxDrag::beginTearGrip(CGPoint point, double phase, double energy, double space) {
    tearEdgeStep = -1;
    double closestDistanceSquared = edgeGripDistance * edgeGripDistance;
    CGPoint start = getContourPoint(0, 1, phase, energy, space);
    for (int step = 0; step < contourSteps; ++step) {
        CGPoint end = getContourPoint(tau * (step + 1) / contourSteps, 1, phase, energy, space);
        double dx = end.x - start.x;
        double dy = end.y - start.y;
        double lengthSquared = dx * dx + dy * dy;
        double projection = std::clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0.0, 1.0);
        double distanceX = point.x - std::lerp(start.x, end.x, projection);
        double distanceY = point.y - std::lerp(start.y, end.y, projection);
        double distanceSquared = distanceX * distanceX + distanceY * distanceY;
        if (distanceSquared < closestDistanceSquared) {
            closestDistanceSquared = distanceSquared;
            tearEdgeStep = step;
        }
        start = end;
    }
}

void RelaxDrag::releaseTears() {
    tearEdgeStep = -1;
    for (auto &tear : tears) {
        tear.isHeld = false;
        tear.strain = 0;
    }
}

void RelaxDrag::advanceTears(double elapsed, bool isDragging, double phase, double energy, double space) {
    constexpr double openAfterReleaseSeconds = 2.0;
    double stretch = std::hypot(offset.dx, offset.dy);
    bool canTear = isDragging && tearEdgeStep >= 0 && stretch > tearThreshold;
    for (int ring = firstTearRing; ring < contourCount; ++ring) {
        auto &tear = tears[ring];
        if (!tear.isHeld && tear.opening == 0) {
            TearSite site = canTear ? findTearSite(ring, phase, energy, space, *this) : TearSite{};
            if (site.step < 0) {
                tear.strain = std::max(0.0, tear.strain - elapsed * 4);
                continue;
            }
            double step = site.step + 0.5;
            if (std::abs(std::remainder(step - tear.step, contourSteps)) > 6) {
                tear.strain = 0;
            }
            tear.step = step;
            double load = std::min(1.0, 0.15 + site.excessPull / 0.05);
            tear.strain += elapsed * load / 0.20;
            if (tear.strain < 1) continue;
            tear.direction = {offset.dx / stretch, offset.dy / stretch};
            tear.isHeld = true;
            tear.strain = 0;
        }
        tear.motionTime += elapsed;
        if (!tear.isHeld) {
            tear.releaseTime += elapsed;
        }
        bool shouldStayOpen = tear.isHeld || tear.releaseTime < openAfterReleaseSeconds;
        double target = shouldStayOpen ? 1.0 : 0.0;
        double frequency = shouldStayOpen ? 5.6 : 3.4;
        advanceSpringAxis(tear.opening, tear.velocity, target, frequency, elapsed);
        if (std::abs(tear.opening - target) < 0.001 && std::abs(tear.velocity) < 0.006) {
            tear.opening = target;
            tear.velocity = 0;
        }
        if (!tear.isHeld && tear.opening == 0) {
            tear = {};
            continue;
        }
        advanceSpringAxis(tear.flex, tear.flexVelocity, tear.opening, 5.8, elapsed);
        if (std::abs(tear.flex - tear.opening) < 0.001 && std::abs(tear.flexVelocity) < 0.006) {
            tear.flex = tear.opening;
            tear.flexVelocity = 0;
        }
    }
}

CGPoint getScenePoint(CGPoint viewPoint, CGSize size) {
    CGPoint center = getSceneCenter(size);
    double scale = getSceneScale(size);
    return {(viewPoint.x - center.x) / scale, (viewPoint.y - center.y) / scale};
}

bool isInsideRelaxFigure(CGPoint point, double phase, double energy, double space) {
    bool isInside = false;
    CGPoint start = getContourPoint(0, 1, phase, energy, space);
    for (int step = 1; step <= contourSteps; ++step) {
        CGPoint end = getContourPoint(tau * step / contourSteps, 1, phase, energy, space);
        if ((start.y > point.y) != (end.y > point.y)) {
            double crossing = start.x + (end.x - start.x) * (point.y - start.y) / (end.y - start.y);
            if (point.x < crossing) isInside = !isInside;
        }
        start = end;
    }
    return isInside;
}

void drawScene(CGContextRef context, CGSize size, Scene scene, double phase, double energy, double space,
               const RelaxDrag &drag) {
    CGContextSaveGState(context);
    CGPoint center = getSceneCenter(size);
    double side = getSceneScale(size);
    CGContextTranslateCTM(context, center.x, center.y);
    CGContextScaleCTM(context, side, side);
    if (scene == Scene::relax) {
        drawContours(context, phase, energy, space, drag);
    } else {
        drawNight(context, phase, energy, space);
    }
    CGContextRestoreGState(context);
}
}
