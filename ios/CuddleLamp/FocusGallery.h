#pragma once

#include <CoreGraphics/CoreGraphics.h>
#include <array>

namespace lamp::gallery {

using Glints = std::array<double, 8>;

void drawArchitecture(CGContextRef context, CGSize size, int localMinute);
void drawReflections(CGContextRef context, CGSize size, int localMinute, double energy, const Glints &glints);

}
