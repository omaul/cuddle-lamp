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
import { advanceWaveField, createWaveField, disturbWaveField, WAVE_COLUMNS, WAVE_ROWS } from './waves';

interface WaterSurfaceProps {
    width: number;
    height: number;
    isPlaying: boolean;
    rms: number;
    space: number;
    isMotionAllowed: boolean;
    impulses: SharedValue<SceneImpulse[]>;
}

interface WaterPointProps {
    cell: number;
    x: number;
    y: number;
    left: number;
    top: number;
    motion: SharedValue<WaterMotion | null>;
}

interface WaterMotion {
    field: ReturnType<typeof createWaveField>;
    elapsed: number;
    seconds: number;
    swell: number;
    lastImpulse: number;
    energy: number;
}

const STEP_MS = 1000 / 30;
const WATER_POINTS = Array.from({ length: WAVE_ROWS * WAVE_COLUMNS }, (_, cell) => ({
    cell,
    x: (cell % WAVE_COLUMNS) / (WAVE_COLUMNS - 1),
    y: Math.floor(cell / WAVE_COLUMNS) / (WAVE_ROWS - 1),
})).filter(({ x, y }) => x > 0 && x < 1 && y > 0 && y < 1);

const WaterPoint = React.memo<WaterPointProps>(({ cell, x, y, left, top, motion }) => {
    const animatedStyle = useAnimatedStyle(() => {
        const state = motion.get();
        let ripple = 0;
        let swell = 0;
        let shimmer = 0;
        if (state) {
            const { field, elapsed, seconds, energy } = state;
            ripple = field.prev[cell] + (field.current[cell] - field.prev[cell]) * (elapsed / STEP_MS);

            const primary = 10 * y + 4 * x - seconds * 1.45;
            const cross = 12 * x - 6 * y - seconds * 1.07;
            const bend = Math.sin(7 * x + 3 * y + seconds * 0.63);
            const crest = Math.sin(primary + 0.8 * bend);
            const crossing = Math.sin(cross);
            swell = state.swell * (crest * 0.62 + crossing * (0.22 + 0.16 * energy));
            shimmer = state.swell * Math.max(0, crest * 0.72 + crossing * 0.28) ** 3;
        }
        const edge = Math.min(1, 0.25 + 4 * Math.min(x, 1 - x, y, 1 - y));
        const height = swell * 13 + ripple * 32;
        const highlight = Math.min(1, shimmer + Math.max(0, ripple) * 2);
        return {
            opacity: edge * Math.min(0.94, Math.max(0.06, 0.17 + swell * 0.14 + highlight * 0.7 + ripple * 0.8)),
            transform: [{ translateY: height }, { scale: 0.82 + highlight * 0.68 }],
        };
    });
    return <Animated.View style={[styles.point, { left, top }, animatedStyle]} />;
});

const WaterSurface: React.FC<WaterSurfaceProps> = ({
    width,
    height,
    isPlaying,
    rms,
    space,
    isMotionAllowed,
    impulses,
}) => {
    const motion = useSharedValue<WaterMotion | null>(null);
    const sound = useSharedValue({ isPlaying, rms, space });
    const handleFrame = useCallback(
        ({ timestamp, timeSincePreviousFrame }: FrameInfo) => {
            'worklet';
            const audio = sound.get();
            const updates = impulses.get();
            if (
                !audio.isPlaying &&
                updates.length === 0 &&
                (motion.get()?.swell ?? 0) < 0.002 &&
                timestamp - (motion.get()?.lastImpulse ?? -Infinity) > 5500
            ) {
                if (motion.get()) {
                    motion.set(null);
                }
                return;
            }
            motion.modify((prev) => {
                const state = prev ?? {
                    field: createWaveField(),
                    elapsed: 0,
                    energy: 0,
                    seconds: 0,
                    swell: 0,
                    lastImpulse: timestamp,
                };
                const frameMs = Math.min(2 * STEP_MS, timeSincePreviousFrame ?? 0);
                const energy = audio.isPlaying ? Math.min(1, Math.sqrt(Math.max(0, audio.rms) * 3)) : 0;
                const swell = audio.isPlaying ? 0.55 + 0.45 * energy : 0;
                state.energy += (energy - state.energy) * (1 - Math.exp(-frameMs / 480));
                state.swell += (swell - state.swell) * (1 - Math.exp(-frameMs / 780));
                state.seconds += frameMs / 1000;
                state.elapsed += frameMs;
                if (state.elapsed < STEP_MS) {
                    return state;
                }
                for (const { x, y, strength } of updates) {
                    disturbWaveField(state.field, x, y, strength);
                }
                if (updates.length > 0) {
                    state.lastImpulse = timestamp;
                    impulses.set([]);
                }
                while (state.elapsed >= STEP_MS) {
                    advanceWaveField(state.field, audio.space);
                    state.elapsed -= STEP_MS;
                }
                return state;
            });
        },
        [impulses, motion, sound],
    );
    const frames = useFrameCallback(handleFrame, false);

    useEffect(() => {
        sound.set({ isPlaying, rms, space });
    }, [isPlaying, rms, sound, space]);

    useEffect(() => {
        if (!isMotionAllowed) {
            motion.set(null);
        }
        frames.setActive(isMotionAllowed);
        return () => frames.setActive(false);
    }, [frames, isMotionAllowed, motion]);

    return WATER_POINTS.map(({ cell, x, y }) => (
        <WaterPoint key={cell} cell={cell} x={x} y={y} left={x * width} top={y * height} motion={motion} />
    ));
};

export default WaterSurface;
