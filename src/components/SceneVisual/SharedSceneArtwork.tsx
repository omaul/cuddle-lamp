import React, { useEffect } from 'react';
import Animated, {
    cancelAnimation,
    Easing,
    type SharedValue,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';
import RelaxContours from '../RelaxContours';
import { getScenePoint, POINT_COUNT } from './geometry';
import type { SceneArtworkProps, SceneImpulse } from './index';
import { getSceneDuration } from './profiles';
import styles from './styles';

const POINTS = Array.from({ length: POINT_COUNT }, (_, index) => index);

interface PointProps {
    sceneId: string | null;
    index: number;
    size: number;
    progress: SharedValue<number>;
}

const Point = React.memo<PointProps>(({ sceneId, index, size, progress }) => {
    const diameter = 1.8 + 1.2 * Math.sin(index * 1.7) ** 2;
    const motion = useAnimatedStyle(() => {
        const { x, y } = getScenePoint(sceneId, index, progress.get());
        return { transform: [{ translateX: x * size }, { translateY: y * size }] };
    });
    return <Animated.View style={[styles.point, { width: diameter, height: diameter }, motion]} />;
});

const SceneArtwork: React.FC<SceneArtworkProps> = (props) => {
    const { sceneId, isMotionAllowed, isPlaying, rms, width, height, space } = props;
    const progress = useSharedValue(0);
    const impulses = useSharedValue<SceneImpulse[]>([]);
    useEffect(() => {
        if (sceneId === 'relax' || !isMotionAllowed || !isPlaying) return;
        progress.set(0);
        progress.set(withRepeat(withTiming(1, { duration: getSceneDuration(sceneId), easing: Easing.linear }), -1));
        return () => cancelAnimation(progress);
    }, [isMotionAllowed, isPlaying, progress, sceneId]);

    if (sceneId === 'relax') {
        return <RelaxContours {...props} impulses={impulses} />;
    }
    const size = Math.min(width, height) * (0.94 + 0.12 * space);
    const level = isPlaying && isMotionAllowed ? Math.min(1, Math.sqrt(Math.max(0, rms) * 3)) : 0;
    return (
        <Animated.View style={[styles.artwork, { left: width / 2, top: height * 0.42, opacity: 0.68 + 0.32 * level }]}>
            {POINTS.map((index) => (
                <Point key={index} {...{ index, sceneId, size, progress }} />
            ))}
        </Animated.View>
    );
};

export default SceneArtwork;
