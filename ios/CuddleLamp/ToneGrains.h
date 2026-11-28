#pragma once

#include <CoreGraphics/CoreGraphics.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iterator>
#include <memory>

#include "ToneGrainsTargets.h"

namespace lamp::toneGrains {

class Surface {
public:
    bool setFrequency(float frequencyHz, bool animate) {
        const auto next = std::find_if(std::begin(targets), std::end(targets), [frequencyHz](const Target &target) {
            return target.frequencyHz == frequencyHz;
        });
        if (next == std::end(targets)) {
            bool hadTarget = target_ != nullptr;
            target_ = nullptr;
            moving_ = false;
            drift_ = targetDrift_ = 0;
            grains_.reset();
            return hadTarget;
        }
        if (next == target_) {
            if (!animate && moving_) {
                settle();
                return true;
            }
            return false;
        }

        animate = animate && target_ != nullptr;
        target_ = next;
        if (!grains_) grains_ = std::make_unique<Grains>();
        const char *encoded = next->points;
        for (auto &grain : *grains_) {
            grain.target = {decode(encoded), decode(encoded + 2)};
            encoded += 4;
        }
        moving_ = animate;
        if (!animate) settle();
        return true;
    }

    bool setSoundLevel(double rms, bool allowsMotion) {
        targetDrift_ = allowsMotion && target_ ? std::clamp((rms - 0.001) / 0.065, 0.0, 1.0) : 0;
        if (allowsMotion || drift_ == 0) return false;
        drift_ = 0;
        return true;
    }

    bool isRetuning() const { return moving_; }

    bool isAnimating() const { return moving_ || drift_ > 0 || targetDrift_ > 0; }

    void advance(double elapsed) {
        advanceDrift(elapsed);
        if (!moving_) return;
        constexpr double response = 8.0;
        const double decay = std::exp(-response * elapsed);
        moving_ = false;
        for (auto &grain : *grains_) {
            const double offsetX = grain.position.x - grain.target.x;
            const double offsetY = grain.position.y - grain.target.y;
            const double stepX = (grain.velocity.dx + response * offsetX) * elapsed;
            const double stepY = (grain.velocity.dy + response * offsetY) * elapsed;
            grain.position = {
                grain.target.x + (offsetX + stepX) * decay,
                grain.target.y + (offsetY + stepY) * decay,
            };
            grain.velocity = {(grain.velocity.dx - response * stepX) * decay,
                              (grain.velocity.dy - response * stepY) * decay};
            moving_ |= std::max(std::abs(offsetX), std::abs(offsetY)) > 0.0003
                || std::max(std::abs(grain.velocity.dx), std::abs(grain.velocity.dy)) > 0.002;
        }
        if (!moving_) settle();
    }

    void draw(CGContextRef context, CGSize size) const {
        if (!grains_) return;
        const double height = std::min(size.height - 12, (size.width - 24) / plateAspect);
        if (height <= 0) return;
        const double width = height * plateAspect;
        const double left = (size.width - width) / 2;
        const double top = (size.height - height) / 2;

        CGContextSaveGState(context);
        CGContextClipToRect(context, CGRectMake(left, top, width, height));

        static constexpr std::array<std::array<double, 3>, 4> colors{{
            {0.510, 0.459, 0.396}, {0.667, 0.600, 0.498},
            {0.788, 0.714, 0.592}, {0.937, 0.859, 0.753},
        }};
        const auto offsets = getDriftOffsets(width);
        std::array<CGRect, 256> rects;
        for (size_t first = 0; first < grains_->size(); first += rects.size()) {
            const auto &color = colors[first * colors.size() / grains_->size()];
            CGContextSetRGBFillColor(context, color[0], color[1], color[2], 1);
            for (size_t index = 0; index < rects.size(); ++index) {
                const auto &position = (*grains_)[first + index].position;
                const auto &offset = offsets[(first + index) * 37 % offsets.size()];
                const double diameter = std::clamp(width / 240, 0.65, 1.5)
                    * (0.75 + 0.04 * double(index % 11));
                rects[index] = CGRectMake(left + position.x * width + offset.dx - diameter / 2,
                                         top + position.y * height + offset.dy - diameter / 2, diameter, diameter);
            }
            CGContextFillRects(context, rects.data(), rects.size());
        }
        CGContextRestoreGState(context);
    }

private:
    struct Grain {
        CGPoint position;
        CGPoint target;
        CGVector velocity;
    };
    using Grains = std::array<Grain, grainCount>;
    using DriftOffsets = std::array<CGVector, 64>;
    static constexpr double tau = 2 * M_PI;
    static constexpr std::array<double, 4> driftRates{0.42, 0.57, 0.75, 0.92};

    static double decode(const char *pair) {
        static constexpr auto codes = [] {
            std::array<uint8_t, 128> values{};
            for (uint8_t index = 0; index < 64; ++index) {
                values[static_cast<unsigned char>(alphabet[index])] = index;
            }
            return values;
        }();
        return ((codes[static_cast<unsigned char>(pair[0])] << 6)
            | codes[static_cast<unsigned char>(pair[1])]) / 4095.0;
    }

    void settle() {
        for (auto &grain : *grains_) {
            grain.position = grain.target;
            grain.velocity = {};
        }
        moving_ = false;
    }

    void advanceDrift(double elapsed) {
        if (drift_ == 0 && targetDrift_ == 0) return;
        drift_ += (targetDrift_ - drift_) * -std::expm1(-elapsed / 0.18);
        if (targetDrift_ == 0 && drift_ < 0.01) {
            drift_ = 0;
            return;
        }
        for (size_t band = 0; band < driftRates.size(); ++band) {
            driftPhases_[band] = std::fmod(driftPhases_[band] + tau * driftRates[band] * elapsed, tau);
        }
    }

    DriftOffsets getDriftOffsets(double plateWidth) const {
        DriftOffsets offsets{};
        if (drift_ == 0) return offsets;

        // Колебания смещают только отрисовку и не меняют оседание песчинок.
        const double amplitude = std::min(1.15, plateWidth * 0.0036) * drift_;
        constexpr size_t bands = driftRates.size();
        for (size_t index = 0; index < offsets.size(); ++index) {
            const size_t band = index % bands;
            const double phase = driftPhases_[band] + index / bands * (tau * bands / offsets.size());
            const double radius = amplitude * (0.55 + 0.15 * band);
            offsets[index] = {radius * std::cos(phase), 0.7 * radius * std::sin(phase + 0.55 * band)};
        }
        return offsets;
    }

    const Target *target_ = nullptr;
    std::unique_ptr<Grains> grains_;
    std::array<double, driftRates.size()> driftPhases_{};
    double drift_ = 0;
    double targetDrift_ = 0;
    bool moving_ = false;
};

}
