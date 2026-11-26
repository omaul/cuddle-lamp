#include "FocusGallery.h"

#include <algorithm>
#include <cmath>

namespace lamp::gallery {
namespace {

struct Color { double r, g, b; };
struct Point { double x, y, z; };

constexpr Color night{0.095, 0.107, 0.137}, stone{0.59, 0.56, 0.50};
constexpr Color sky{0.77, 0.86, 0.94}, amber{1, 0.66, 0.33};
constexpr double wall = 2.65, spring = 2.35, rise = 1.95;
constexpr std::array<double, 8> depths{2.0, 3.9, 5.8, 7.7, 9.6, 11.5, 13.4, 15.3};

Color mix(Color a, Color b, double amount) {
    return {a.r + (b.r-a.r)*amount, a.g + (b.g-a.g)*amount, a.b + (b.b-a.b)*amount};
}

struct Light {
    double day, window, lamp, slope;
    explicit Light(int minute) {
        double angle = (minute / 60.0 - 12.0) * M_PI / 12;
        double height = std::cos(angle);
        day = std::clamp((height + 0.16) / 0.96, 0.0, 1.0);
        window = 0.075 + 0.925 * std::clamp((height + 0.27) / 0.85, 0.0, 1.0);
        lamp = 1 - std::clamp((height + 0.12) / 0.47, 0.0, 1.0);
        slope = std::sin(angle);
    }
};

struct Camera {
    double focal;
    CGPoint horizon;
    explicit Camera(CGSize size) : focal(std::min(size.width * 0.86, size.height * 0.34)),
        horizon{size.width * 0.59, size.height * 0.385} {}

    CGPoint project(Point p) const {
        return {horizon.x + (p.x - 0.32) * focal / p.z, horizon.y - (p.y - 1.35) * focal / p.z};
    }
};

void fill(CGContextRef ctx, Color color, double alpha = 1) {
    CGContextSetRGBFillColor(ctx, color.r, color.g, color.b, alpha);
}

void path(CGContextRef ctx, const Camera &camera, std::initializer_list<Point> vertices) {
    CGContextBeginPath(ctx);
    auto it = vertices.begin();
    CGPoint first = camera.project(*it++);
    CGContextMoveToPoint(ctx, first.x, first.y);
    for (; it != vertices.end(); ++it) {
        CGPoint p = camera.project(*it);
        CGContextAddLineToPoint(ctx, p.x, p.y);
    }
    CGContextClosePath(ctx);
}

void polygon(CGContextRef ctx, const Camera &camera, std::initializer_list<Point> vertices) {
    path(ctx, camera, vertices);
    CGContextFillPath(ctx);
}

Point vault(double angle, double depth, double inset = 0) {
    return {(wall - inset) * std::cos(angle), spring + (rise - inset) * std::sin(angle), depth};
}

void gradient(CGContextRef ctx, CGPoint from, CGPoint to, Color a, Color b, double alphaA, double alphaB) {
    const CGFloat colors[] = {a.r,a.g,a.b,alphaA, b.r,b.g,b.b,alphaB};
    CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
    CGGradientRef blend = CGGradientCreateWithColorComponents(space, colors, nullptr, 2);
    CGContextDrawLinearGradient(ctx, blend, from, to, 0);
    CGGradientRelease(blend);
    CGColorSpaceRelease(space);
}

void glow(CGContextRef ctx, CGPoint center, double width, double height, Color color, double alpha) {
    const CGFloat colors[] = {color.r,color.g,color.b,alpha, color.r,color.g,color.b,alpha*0.38,
                              color.r,color.g,color.b,0};
    const CGFloat stops[] = {0, 0.48, 1};
    CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
    CGGradientRef blend = CGGradientCreateWithColorComponents(space, colors, stops, 3);
    CGContextSaveGState(ctx);
    CGContextTranslateCTM(ctx, center.x, center.y);
    CGContextScaleCTM(ctx, width, height);
    CGContextDrawRadialGradient(ctx, blend, CGPointZero, 0, CGPointZero, 1, 0);
    CGContextRestoreGState(ctx);
    CGGradientRelease(blend);
    CGColorSpaceRelease(space);
}

void drawSunPatch(CGContextRef ctx, const Camera &camera, const Light &light, bool onWall) {
    double reach = 1.35 + 2.3 * (1 - light.day);
    double hit = 2*wall/reach;
    double drift = 0.18 + 0.96*light.slope;
    auto projectLight = [&](double y, double z) -> Point {
        if (onWall) return {wall, y-hit, z+hit*drift};
        return {-wall+y*reach, 0, z+y*drift};
    };
    Color sunlight = mix(sky, {1.0, 0.82, 0.60}, light.day * 0.65);
    fill(ctx, sunlight, light.window*0.68);
    for (int pane=0; pane<2; ++pane) {
        double z0=4.145+pane*0.70, z1=z0+0.65;
        for (auto range : {std::array{1.02,1.90}, std::array{1.94,2.24}}) {
            double start = onWall ? std::max(hit,range[0]) : range[0];
            double end = onWall ? range[1] : std::min(range[1],hit);
            if (end>start) polygon(ctx,camera,{projectLight(start,z0),projectLight(start,z1),
                                               projectLight(end,z1),projectLight(end,z0)});
        }
    }
}

void drawBay(CGContextRef ctx, const Camera &camera, const Light &light, double front, double back) {
    double depth = 1 / (1 + front * 0.085);
    for (double side : {-wall, wall}) {
        double lit = (side > 0 ? 0.45 : 0.28) * light.day;
        fill(ctx, mix(night, stone, depth * (0.21 + lit)));
        polygon(ctx, camera, {{side,0,front},{side,0,back},{side,spring,back},{side,spring,front}});
        CGContextSaveGState(ctx);
        path(ctx,camera,{{side,0,front},{side,0,back},{side,spring,back},{side,spring,front}});
        CGContextClip(ctx);
        glow(ctx,camera.project({side,1.56,4.72}),camera.focal*0.55,camera.focal*0.49,
             sky, (side<0 ? 0.26 : 0.20)*light.window);
        if (side>0) drawSunPatch(ctx,camera,light,true);
        else glow(ctx,camera.project({-wall,0.47,4.65}),camera.focal*0.36,camera.focal*0.28,
                  amber,0.43*light.lamp);
        CGContextRestoreGState(ctx);
        for (int row = 1; row < 6; ++row) {
            double y = spring * row / 6;
            fill(ctx, night, 0.26);
            polygon(ctx, camera, {{side,y,front},{side,y,back},{side,y+0.009,back},{side,y+0.009,front}});
        }
    }

    constexpr int blocks = 32;
    for (int block = 0; block < blocks; ++block) {
        double a = M_PI * block / blocks, b = M_PI * (block + 1) / blocks;
        double incidence = 0.5 + 0.5 * std::cos(a - 0.22);
        double shade = 0.11 + 0.22 * incidence + light.day * (0.09 + 0.31 * incidence);
        fill(ctx, mix(night, stone, shade * depth));
        polygon(ctx, camera, {vault(a,front), vault(b,front), vault(b,back), vault(a,back)});
    }
}

void drawRib(CGContextRef ctx, const Camera &camera, const Light &light, double z) {
    const double inset = 0.16;
    for (double side : {-1.0, 1.0}) {
        double outer = side * wall, inner = side * (wall-inset);
        fill(ctx, mix(night, stone, 0.24 + 0.30 * light.day));
        polygon(ctx, camera, {{outer,0,z},{inner,0,z},{inner,spring,z},{outer,spring,z}});
        fill(ctx, mix(night, stone, 0.09 + 0.12 * light.day));
        polygon(ctx, camera, {{inner,0,z},{inner,0,z+0.17},{inner,spring,z+0.17},{inner,spring,z}});
        for (double y : {0.08, spring-0.09}) {
            fill(ctx, mix(night, stone, 0.36 + 0.32 * light.day));
            polygon(ctx, camera, {{outer,y,z-0.035},{inner-side*0.06,y,z-0.035},
                {inner-side*0.06,y+0.065,z-0.035},{outer,y+0.065,z-0.035}});
        }
    }
    for (int stoneIndex = 0; stoneIndex < 28; ++stoneIndex) {
        double a = M_PI * stoneIndex / 28, b = M_PI * (stoneIndex+1) / 28;
        double variation = 0.035 * std::sin(stoneIndex*24.91+z);
        fill(ctx, mix(night, stone, 0.27 + 0.34 * light.day + variation + 0.09 * std::cos(a)));
        polygon(ctx, camera, {vault(a,z), vault(b,z), vault(b,z,inset), vault(a,z,inset)});
        fill(ctx, mix(night, stone, 0.095 + 0.17 * light.day + variation));
        polygon(ctx, camera, {vault(a,z,inset), vault(b,z,inset), vault(b,z+0.17,inset), vault(a,z+0.17,inset)});
    }
}

void drawWindow(CGContextRef ctx, const Camera &camera, const Light &light) {
    constexpr double z0 = 4.12, z1 = 5.52, sill = 1.02, top = 2.24;
    fill(ctx, mix(night, sky, 0.18 + 0.80 * light.window));
    polygon(ctx, camera, {{-wall,sill,z0},{-wall,sill,z1},{-wall,top,z1},{-wall,top,z0}});
    fill(ctx, mix(night, stone, 0.18));
    double middle = (z0+z1)*0.5;
    polygon(ctx, camera, {{-wall,sill,middle-0.035},{-wall,top,middle-0.035},
        {-wall,top,middle+0.035},{-wall,sill,middle+0.035}});
    polygon(ctx, camera, {{-wall,1.90,z0},{-wall,1.94,z0},{-wall,1.94,z1},{-wall,1.90,z1}});
    fill(ctx, mix(night, stone, 0.46 + 0.40 * light.window));
    polygon(ctx, camera, {{-wall,sill,z0},{-wall,sill,z1},{-wall+0.13,sill,z1},{-wall+0.13,sill,z0}});
}

void drawFloor(CGContextRef ctx, const Camera &camera, const Light &light) {
    for (int tile = -5; tile < 5; ++tile) {
        double x = tile * 0.55;
        fill(ctx, night, 0.38);
        polygon(ctx, camera, {{x,0,0.3},{x+0.009,0,0.3},{x+0.009,0,17},{x,0,17}});
    }
    for (double z : depths) {
        fill(ctx, night, 0.35);
        polygon(ctx, camera, {{-wall,0,z},{wall,0,z},{wall,0,z+0.018},{-wall,0,z+0.018}});
    }
    glow(ctx,camera.project({-0.78,0,4.85}),camera.focal*0.64,camera.focal*0.19,
         {0.89,0.79,0.63},0.38*light.window);
    drawSunPatch(ctx,camera,light,false);
}

void drawBench(CGContextRef ctx, const Camera &camera, const Light &light) {
    constexpr double near = 4.02, far = 5.67, front = -wall+0.54, back = -wall+0.08;
    for (double z : {near+0.12, far-0.17}) {
        fill(ctx, mix(night, stone, 0.19+0.17*light.day));
        polygon(ctx, camera, {{front-0.08,0,z},{back,0,z},{back,0.39,z},{front-0.08,0.39,z}});
    }
    fill(ctx, mix(night, stone, 0.32+0.37*light.day));
    polygon(ctx, camera, {{back,0.46,near},{front,0.46,near},{front,0.46,far},{back,0.46,far}});
    fill(ctx, mix(night, stone, 0.17+0.12*light.day));
    polygon(ctx, camera, {{front,0.46,near},{front,0.38,near},{front,0.38,far},{front,0.46,far}});
    fill(ctx, amber, light.lamp*0.83);
    polygon(ctx, camera, {{front-0.02,0.38,near},{front-0.02,0.365,near},{front-0.02,0.365,far},{front-0.02,0.38,far}});
}

void drawLamplight(CGContextRef ctx, const Camera &camera, const Light &light) {
    if (light.lamp <= 0) return;
    constexpr int strips = 40;
    for (int i=0; i<strips; ++i) {
        double t = double(i)/strips;
        fill(ctx, amber, 0.34*light.lamp*(1-t)*(1-t));
        double x = -wall+0.21+1.75*t;
        polygon(ctx, camera, {{x,0,3.98-0.25*t},{x,0,5.72+0.25*t},
            {x+1.75/strips,0,5.72+0.25*t},{x+1.75/strips,0,3.98-0.25*t}});
        double y = t*1.02;
        polygon(ctx, camera, {{-wall,y,3.98},{-wall,y,5.72},{-wall,y+1.02/strips,5.72},{-wall,y+1.02/strips,3.98}});
    }
}

}

void drawArchitecture(CGContextRef ctx, CGSize size, int localMinute) {
    Camera camera(size);
    Light light(localMinute);
    CGRect bounds = CGRectMake(0,0,size.width,size.height);
    Color floor = mix(night, stone, 0.19 + 0.31 * light.day);
    fill(ctx, floor);
    CGContextFillRect(ctx, bounds);
    drawFloor(ctx, camera, light);
    // В торце виден проём соседней анфилады, частично освещённый из-за угла.
    constexpr double end = 17.3;
    fill(ctx,mix(night,stone,0.12+0.24*light.day));
    polygon(ctx,camera,{{-wall,0,end},{wall,0,end},{wall,spring+rise,end},{-wall,spring+rise,end}});
    fill(ctx,mix(night,stone,0.08));
    polygon(ctx,camera,{{-0.66,0,end},{0.66,0,end},{0.66,2.20,end},{-0.66,2.20,end}});
    fill(ctx,mix(night,stone,0.36+0.21*light.day));
    polygon(ctx,camera,{{0.51,0,end},{0.66,0,end},{0.66,2.20,end},{0.51,2.08,end}});
    for (int index = int(depths.size())-1; index >= -1; --index) {
        double back = index+1 < int(depths.size()) ? depths[index+1] : 17.3;
        double front = index >= 0 ? depths[index] : 0.30;
        drawBay(ctx,camera,light,front,back);
        if (index == 1) {
            drawWindow(ctx,camera,light);
            drawLamplight(ctx,camera,light);
            drawBench(ctx,camera,light);
        }
        if (index >= 0) drawRib(ctx,camera,light,front);
    }
    // Мелкое зерно остаётся на месте при изменениях света и громкости.
    uint32_t seed = 751;
    auto next = [&]() {
        seed = seed * 1664525u + 1013904223u;
        return double(seed) / 4294967296.0;
    };
    std::array<CGRect,512> pores;
    for (int batch=0; batch<18; ++batch) {
        for (auto &pore : pores) {
            double x = next()*size.width, y = next()*size.height*0.76;
            pore = CGRectMake(x,y,0.55+next()*0.68,0.35+next()*0.62);
        }
        fill(ctx,batch%2 ? sky : night,0.12);
        CGContextFillRects(ctx,pores.data(),pores.size());
    }
    Color background{0.078,0.082,0.09};
    gradient(ctx,{0,0},{0,size.height*0.22},background,background,0.95,0);
    gradient(ctx,{0,size.height*0.52},{0,size.height*0.78},background,background,0,1);
    fill(ctx,background);
    CGContextFillRect(ctx,CGRectMake(0,size.height*0.78,size.width,size.height*0.22+1));
}

void drawReflections(CGContextRef ctx, CGSize size, int localMinute, double energy, const Glints &glints) {
    Camera camera(size);
    Light light(localMinute);
    Color tint = mix(sky,amber,light.lamp);
    CGContextSetLineCap(ctx,kCGLineCapRound);
    for (size_t rib = 0; rib < depths.size(); ++rib) {
        double intensity = glints[rib];
        double z = depths[rib];
        double breath = energy * (0.06 + 0.08 * light.window);
        fill(ctx,tint,breath);
        polygon(ctx,camera,{{-wall+0.16,0,z},{-wall+0.16,0,z+0.14},
            {-wall+0.16,spring,z+0.14},{-wall+0.16,spring,z}});
        // Тихий фон проявляет поры в камне. Удар освещает кромку одного свода.
        for (int fleck=0; fleck<32; ++fleck) {
            double a = 0.19 + 2.69 * fleck / 31;
            CGPoint p = camera.project(vault(a,z,0.065+0.033*std::sin(fleck*39.1+z)));
            fill(ctx,stone,energy*(0.12+0.20*std::pow(std::sin(fleck*32.7),2)));
            double radius = std::max(0.38,0.009*camera.focal/z);
            CGContextFillEllipseInRect(ctx,{p,{radius*1.7,radius}});
        }
        if (intensity < 0.001) continue;
        for (int step=0; step<24; ++step) {
            double weight = std::pow(std::sin(M_PI*(step+0.5)/24),1.5);
            double a = 0.56 + step*0.049;
            CGPoint from = camera.project(vault(a,z,0.155)), to = camera.project(vault(a+0.049,z,0.155));
            CGContextSetRGBStrokeColor(ctx,tint.r,tint.g,tint.b,weight*intensity*0.92);
            CGContextSetLineWidth(ctx,std::max(0.9,0.022*camera.focal/z));
            CGContextStrokeLineSegments(ctx,std::array{from,to}.data(),2);
        }
    }
}
}
