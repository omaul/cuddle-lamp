#pragma once

#include <CoreGraphics/CoreGraphics.h>

namespace lamp {

enum class Scene { relax, sleep, gallery };

struct RelaxDrag {
    CGPoint anchor = {};
    CGVector offset = {};
};

CGPoint getScenePoint(CGPoint viewPoint, CGSize size);
bool isInsideRelaxFigure(CGPoint scenePoint, double phase, double energy, double space);
void drawScene(CGContextRef context, CGSize size, Scene scene, double phase, double energy, double space,
               const RelaxDrag &drag);

}
