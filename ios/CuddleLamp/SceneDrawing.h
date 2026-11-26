#pragma once

#include <CoreGraphics/CoreGraphics.h>

namespace lamp {

enum class Scene { relax, sleep, gallery };

void drawScene(CGContextRef context, CGSize size, Scene scene, double phase, double energy, double space);

}
