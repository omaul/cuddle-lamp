#include "SceneDrawing.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace lamp {
namespace {

constexpr double tau = 2 * M_PI;
constexpr int contourSteps = 96;
constexpr int lastRing = 26;
constexpr double dragRadius = 0.23;

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

void drawContours(CGContextRef context, double phase, double energy, double space, const RelaxDrag &drag) {
    std::array<CGPoint, contourSteps + 1> points;
    bool isDeformed = drag.offset.dx != 0 || drag.offset.dy != 0;
    CGContextSetLineJoin(context, kCGLineJoinRound);
    for (int ring = 0; ring <= lastRing; ++ring) {
        double fraction = double(ring) / lastRing;
        for (int step = 0; step <= contourSteps; ++step) {
            CGPoint point = getContourPoint(tau * step / contourSteps, fraction, phase, energy, space);
            if (isDeformed) {
                double dx = point.x - drag.anchor.x;
                double dy = point.y - drag.anchor.y;
                double weight = std::max(0.0, 1 - (dx * dx + dy * dy) / (dragRadius * dragRadius));
                point.x += drag.offset.dx * weight * weight;
                point.y += drag.offset.dy * weight * weight;
            }
            points[step] = point;
        }
        CGContextSetLineWidth(context, ring % 7 == 0 ? 0.0026 : 0.0018);
        for (int step = 0; step < contourSteps; step += 8) {
            double light = std::pow(0.5 + 0.5 * std::cos(tau * (step + 4) / contourSteps - 6 * fraction + phase), 2);
            CGContextSetRGBStrokeColor(context, 0.68 + 0.32 * light, 0.46 + 0.33 * light, 0.59, 0.30 + 0.55 * light);
            CGContextAddLines(context, points.data() + step, 9);
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
