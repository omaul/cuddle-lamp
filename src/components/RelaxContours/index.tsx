import React, { useCallback, useEffect } from 'react';
import Animated, {
    useAnimatedStyle,
    useFrameCallback,
    useSharedValue,
    type FrameInfo,
    type SharedValue,
} from 'react-native-reanimated';
import type { SceneImpulse } from '../SceneVisual';
import styles from './styles';

interface RelaxContoursProps {
    width: number;
    height: number;
    isPlaying: boolean;
    rms: number;
    space: number;
    isMotionAllowed: boolean;
    impulses: SharedValue<SceneImpulse[]>;
}

interface RelaxMotion {
    angle: number;
    breath: number;
    energy: number;
    space: number;
    touches: SceneImpulse[];
}

interface ContourProps {
    fraction: number;
    diameter: number;
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    motion: SharedValue<RelaxMotion>;
}

const TAU = 2 * Math.PI;
const REST_MOTION: RelaxMotion = {
    angle: 0,
    breath: 0,
    energy: 0,
    space: 0.5,
    touches: [],
};
const CONTOUR_FRACTIONS = Array.from({ length: 22 }, (_, index) => index / 21);
const PALETTE = ['#ffe0b7', '#f1aa8d', '#d98c8b', '#aa83a9', '#8e7eb1'];

const Contour = React.memo<ContourProps>(({ fraction, diameter, centerX, centerY, width, height, motion }) => {
    const size = diameter * (0.22 + fraction * 0.78);
    const color = PALETTE[Math.min(PALETTE.length - 1, Math.floor(fraction * PALETTE.length))];
    const contourStyle = useAnimatedStyle(() => {
        const { angle, breath, energy, space, touches } = motion.get();
        const turn = fraction * 5;
        const fold = Math.sin(turn + breath * 0.9 * Math.sin(angle * 2));
        const flare = Math.cos(turn - breath * 1.4 * Math.sin(angle * 3));
        const radius = size * 0.46;
        const slope = 0.26 + 0.33 * fold + 0.14 * breath * Math.sin(angle);
        const scaleX = 0.96 + 0.07 * flare + 0.075 * space;
        const scaleY = 0.77 + 0.14 * fold + 0.08 * energy;
        const driftX = diameter * (0.037 * fold + 0.045 * breath * Math.sin(angle * 2));
        const driftY = diameter * (0.03 * flare + 0.035 * breath * Math.cos(angle * 3));
        const cosSlope = Math.cos(slope);
        const sinSlope = Math.sin(slope);
        let pullX = 0;
        let pullY = 0;
        let illumination = 0;
        for (const touch of touches) {
            const dx = touch.x * width - centerX - driftX;
            const dy = touch.y * height - centerY - driftY;
            const along = dx * cosSlope + dy * sinSlope;
            const across = dy * cosSlope - dx * sinSlope;
            const separation = (Math.hypot(along / scaleX, across / scaleY) - radius) / diameter;
            const influence = Math.exp(-44 * separation ** 2) * touch.strength;
            pullX += dx * influence;
            pullY += dy * influence;
            illumination += influence;
        }
        const touchWeight = 1 / Math.max(1, illumination);
        const glow = Math.min(1, illumination);
        const edge = 1 - fraction * 0.7;
        const crest = (0.5 + 0.5 * Math.cos(fraction * 15 - angle * 3)) ** 5;
        return {
            opacity: Math.min(0.88, edge * (0.54 + breath * crest * 0.28) + glow * 0.3),
            transform: [
                { translateX: driftX + 0.19 * pullX * touchWeight },
                { translateY: driftY + 0.19 * pullY * touchWeight },
                { rotate: `${slope + 0.0015 * pullX * touchWeight}rad` },
                { skewX: `${0.12 * flare}rad` },
                { scaleX: scaleX + 0.06 * glow },
                { scaleY: scaleY + 0.06 * glow },
            ],
        };
    });

    return (
        <Animated.View
            style={[
                styles.contour,
                {
                    width: size,
                    height: size,
                    left: centerX - size / 2,
                    top: centerY - size / 2,
                    borderTopLeftRadius: size * 0.47,
                    borderTopRightRadius: size * 0.53,
                    borderBottomRightRadius: size * 0.42,
                    borderBottomLeftRadius: size * 0.56,
                    borderColor: color,
                },
                contourStyle,
            ]}
        />
    );
});

const RelaxContours: React.FC<RelaxContoursProps> = ({
    width,
    height,
    isPlaying,
    rms,
    space,
    isMotionAllowed,
    impulses,
}) => {
    const motion = useSharedValue(REST_MOTION);
    const sound = useSharedValue({ isPlaying, rms, space });
    const handleFrame = useCallback(
        ({ timeSincePreviousFrame }: FrameInfo) => {
            'worklet';
            const audio = sound.get();
            const prev = motion.get();
            const updates = impulses.get();
            const elapsed = Math.min(34, timeSincePreviousFrame ?? 0);
            const targetSpace = Math.min(1, Math.max(0, audio.space));
            if (
                !audio.isPlaying &&
                prev.breath === 0 &&
                prev.energy === 0 &&
                updates.length === 0 &&
                prev.touches.length === 0 &&
                Math.abs(targetSpace - prev.space) < 0.001
            ) {
                return;
            }
            const breath = prev.breath + ((audio.isPlaying ? 1 : 0) - prev.breath) * (1 - Math.exp(-elapsed / 850));
            const targetEnergy = audio.isPlaying ? Math.min(1, Math.sqrt(Math.max(0, audio.rms) * 3)) : 0;
            const energy = prev.energy + (targetEnergy - prev.energy) * (1 - Math.exp(-elapsed / 540));
            const decay = Math.exp(-elapsed / 520);
            const touches = prev.touches
                .map(({ x, y, strength }) => ({
                    x,
                    y,
                    strength: strength * decay,
                }))
                .filter(({ strength }) => strength >= 0.006);
            if (updates.length > 0) {
                impulses.set([]);
            }
            motion.set({
                angle: (prev.angle + (elapsed * breath * TAU) / 36000) % TAU,
                breath: breath < 0.001 ? 0 : breath,
                energy: energy < 0.001 ? 0 : energy,
                space: prev.space + (targetSpace - prev.space) * (1 - Math.exp(-elapsed / 560)),
                touches: [...touches, ...updates].slice(-6),
            });
        },
        [impulses, motion, sound],
    );
    const frames = useFrameCallback(handleFrame, false);
    const lightStyle = useAnimatedStyle(() => {
        const { angle, breath, energy } = motion.get();
        return {
            opacity: 0.64 + 0.26 * energy + 0.1 * breath * Math.cos(angle * 3),
            transform: [
                { translateX: 14 * breath * Math.sin(angle * 2) },
                { translateY: 13 * breath * Math.cos(angle * 3) },
                { scale: 0.95 + 0.13 * breath * Math.sin(angle * 2) },
            ],
        };
    });

    useEffect(() => {
        sound.set({ isPlaying, rms, space });
    }, [isPlaying, rms, sound, space]);

    useEffect(() => {
        if (!isMotionAllowed) {
            motion.set(REST_MOTION);
        }
        frames.setActive(isMotionAllowed);
        return () => frames.setActive(false);
    }, [frames, isMotionAllowed, motion]);

    const diameter = Math.min(width * 0.84, height * 0.51, 440);
    const centerX = width * 0.5;
    const centerY = height * 0.42;

    return (
        <>
            <Animated.View
                style={[
                    styles.light,
                    {
                        left: centerX - diameter * 0.69,
                        top: centerY - diameter * 0.59,
                        width: diameter * 1.38,
                        height: diameter * 1.18,
                    },
                    lightStyle,
                ]}
            />
            {CONTOUR_FRACTIONS.map((fraction) => (
                <Contour
                    key={fraction}
                    {...{
                        fraction,
                        diameter,
                        centerX,
                        centerY,
                        width,
                        height,
                        motion,
                    }}
                />
            ))}
        </>
    );
};

export default RelaxContours;
