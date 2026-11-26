// Черновик для звука с регулируемой частотой. Идея — менять фигуру Хладни
// при изменении частоты тона. В сохранённой версии переходом управляет фаза.
#include <CoreGraphics/CoreGraphics.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace lamp::toneGrains {
namespace {

constexpr double tau = 2 * M_PI;

double nextUnit(uint32_t &seed) {
    seed = 1664525u * seed + 1013904223u;
    return double(seed) / 4294967296.0;
}

struct Grain {
    CGPoint modes[3];
    double size;
};

// В узлах стоячей волны песок собирается в линии. Одна и та же песчинка
// занимает своё место в каждой фигуре, поэтому при переходе виден её путь.
CGPoint settle(double x, double y, double a, double b, double balance, double attraction) {
    double startX = x, startY = y;
    for (int step = 0; step < 6; ++step) {
        double cx = std::cos(a * x), cy = std::cos(b * y);
        double dx = std::cos(b * x), dy = std::cos(a * y);
        double field = cx * cy - balance * dx * dy;
        double slopeX = -a * std::sin(a * x) * cy + balance * b * std::sin(b * x) * dy;
        double slopeY = -b * cx * std::sin(b * y) + balance * a * dx * std::sin(a * y);
        double stepSize = std::clamp(field / (slopeX * slopeX + slopeY * slopeY + 0.08), -0.075, 0.075);
        x -= stepSize * slopeX;
        y -= stepSize * slopeY;
    }
    return {startX + (x - startX) * attraction, startY + (y - startY) * attraction};
}

constexpr size_t grainCount = 8192;

std::array<Grain, grainCount> makeGrains() {
    std::array<Grain, grainCount> grains;
    uint32_t seed = 151;
    for (auto &grain : grains) {
        double x = (nextUnit(seed) - 0.5) * 2.5;
        double y = (nextUnit(seed) - 0.5) * 4.1;
        double attraction = 1 - std::pow(nextUnit(seed), 4);
        double scatterX = (nextUnit(seed) - 0.5) * 0.035;
        double scatterY = (nextUnit(seed) - 0.5) * 0.035;
        grain.modes[0] = settle(x, y, 2.6 * M_PI, 1.25 * M_PI, -0.96, attraction);
        grain.modes[1] = settle(x, y, 3.75 * M_PI, 2 * M_PI, 0.88, attraction);
        grain.modes[2] = settle(x, y, 3.25 * M_PI, 0.8 * M_PI, -0.83, attraction);
        for (auto &point : grain.modes) {
            point.x += scatterX;
            point.y += scatterY;
        }
        grain.size = 0.003 + 0.004 * nextUnit(seed);
    }
    return grains;
}
}

// Прежний темп перехода между тремя фигурами при уровне звука от 0 до 1.
double advancePhase(double phase, double elapsedSeconds, double energy) {
    return std::fmod(phase + elapsedSeconds * tau * energy / 48, tau);
}

void draw(CGContextRef context, CGSize size, double phase, double energy, double space) {
    static const auto grains = makeGrains();
    double progress = phase * 3 / tau;
    int mode = int(progress) % 3;
    double blend = progress - std::floor(progress);
    blend = blend * blend * (3 - 2 * blend);
    double shortSide = std::min(size.width, size.height);
    double longSide = std::max(size.width, size.height);
    double scale = std::max(shortSide, longSide * 0.60) * (0.53 + 0.02 * energy);
    CGContextSaveGState(context);
    CGContextTranslateCTM(context, size.width / 2, size.height / 2);
    CGContextRotateCTM(context, (size.width > size.height ? M_PI_2 : 0) + 0.035 * space * std::sin(phase));
    CGContextScaleCTM(context, scale, scale);

    // Песчинки одного оттенка отправляются в Core Graphics одним вызовом.
    std::array<CGRect, 512> rects;
    for (size_t start = 0; start < grains.size(); start += rects.size()) {
        double tone = double(start) / grains.size();
        CGContextSetRGBFillColor(context, 0.61 + 0.36 * tone, 0.65 + 0.32 * tone, 0.70 + 0.29 * tone,
                                 (0.36 + 0.52 * tone) * (0.88 + 0.12 * energy));
        for (size_t index = 0; index < rects.size(); ++index) {
            const auto &grain = grains[start + index];
            CGPoint from = grain.modes[mode], to = grain.modes[(mode + 1) % 3];
            rects[index] = CGRectMake(from.x + (to.x - from.x) * blend, from.y + (to.y - from.y) * blend,
                                      grain.size, grain.size);
        }
        CGContextFillRects(context, rects.data(), rects.size());
    }
    CGContextRestoreGState(context);
}
}
