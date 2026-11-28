#pragma once

#include <CoreGraphics/CoreGraphics.h>
#include <array>

namespace lamp {

enum class Scene { relax, sleep, gallery };

struct RelaxTear {
    double step = 0;
    CGVector direction = {};
    double strain = 0;
    double opening = 0;
    double velocity = 0;
    double flex = 0;
    double flexVelocity = 0;
    double motionTime = 0;
    double releaseTime = 0;
    bool isHeld = false;
};

struct RelaxDrag {
    static constexpr int contourCount = 27;
    CGPoint anchor = {};
    CGVector offset = {};
    int tearEdgeStep = -1;
    std::array<RelaxTear, contourCount> tears = {};

    bool hasTearAnimation() const;
    bool hasVisibleTears() const;
    void beginTearGrip(CGPoint point, double phase, double energy, double space);
    void releaseTears();
    void advanceTears(double elapsed, bool isDragging, double phase, double energy, double space);
};

CGPoint getScenePoint(CGPoint viewPoint, CGSize size);
bool isInsideRelaxFigure(CGPoint scenePoint, double phase, double energy, double space);
void advanceSpringAxis(double &position, double &velocity, double target, double frequency, double elapsed);
void drawScene(CGContextRef context, CGSize size, Scene scene, double phase, double energy, double space,
               const RelaxDrag &drag);

}
