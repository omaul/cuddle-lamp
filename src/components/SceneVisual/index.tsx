import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, View } from 'react-native';
import { getScenePoint, POINT_COUNT } from './geometry';
import { getSceneDuration } from './profiles';
import styles from './styles';

interface SceneVisualProps {
    sceneId: string | null;
    isPlaying: boolean;
    rms: number;
}

const PHASES = Array.from({ length: 41 }, (_, index) => index / 40);

const SceneVisual: React.FC<SceneVisualProps> = ({ sceneId, isPlaying, rms }) => {
    const [size, setSize] = useState(0);
    const [isMotionAllowed, setIsMotionAllowed] = useState(false);
    const [isForeground, setIsForeground] = useState(
        AppState.currentState === 'active' || AppState.currentState === null,
    );
    const phase = useRef(new Animated.Value(0)).current;
    const energy = useRef(new Animated.Value(0)).current;
    const duration = getSceneDuration(sceneId);
    const scale = useMemo(
        () =>
            energy.interpolate({
                inputRange: [0, 1],
                outputRange: [0.94, 1.08],
            }),
        [energy],
    );
    const opacity = useMemo(
        () =>
            energy.interpolate({
                inputRange: [0, 1],
                outputRange: [0.69, 1],
            }),
        [energy],
    );

    const points = useMemo(() => {
        return Array.from({ length: POINT_COUNT }, (_, index) => {
            const positions = PHASES.map((progress) => getScenePoint(sceneId, index, progress));
            const origin = positions[0];
            return {
                origin,
                x: phase.interpolate({
                    inputRange: PHASES,
                    outputRange: positions.map((position) => position.x * size),
                }),
                y: phase.interpolate({
                    inputRange: PHASES,
                    outputRange: positions.map((position) => position.y * size),
                }),
                diameter: index % 11 === 0 ? 4 : 1.8 + 1.2 * Math.sin(index * 1.7) ** 2,
                opacity: 0.35 + 0.65 * Math.sin(index * 2.4) ** 2,
            };
        });
    }, [phase, sceneId, size]);

    useEffect(() => {
        let hasPreferenceChanged = false;
        let isMounted = true;
        const preference = AccessibilityInfo.addEventListener('reduceMotionChanged', (isReduced) => {
            hasPreferenceChanged = true;
            setIsMotionAllowed(!isReduced);
        });
        AccessibilityInfo.isReduceMotionEnabled()
            .then((isReduced) => {
                if (isMounted && !hasPreferenceChanged) {
                    setIsMotionAllowed(!isReduced);
                }
            })
            .catch(() => {});
        const appState = AppState.addEventListener('change', (state) => setIsForeground(state === 'active'));
        return () => {
            isMounted = false;
            preference.remove();
            appState.remove();
        };
    }, []);

    useEffect(() => {
        if (!isPlaying || !isMotionAllowed || !isForeground) {
            return;
        }
        const animation = Animated.loop(
            Animated.timing(phase, {
                toValue: 1,
                duration,
                easing: Easing.linear,
                isInteraction: false,
                useNativeDriver: true,
            }),
        );
        animation.start();
        return () => animation.stop();
    }, [isForeground, isMotionAllowed, isPlaying, phase, duration]);

    useEffect(() => {
        if (!isMotionAllowed || !isForeground) {
            energy.setValue(0);
            return;
        }
        const animation = Animated.timing(energy, {
            toValue: isPlaying ? Math.min(1, Math.sqrt(Math.max(0, rms) * 3)) : 0,
            duration: 320,
            isInteraction: false,
            useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [energy, isForeground, isMotionAllowed, isPlaying, rms]);

    return (
        <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.canvas}
            onLayout={({ nativeEvent }) => {
                const { width, height } = nativeEvent.layout;
                setSize(Math.min(width, height));
            }}
        >
            <Animated.View style={[styles.artwork, { width: size, height: size, opacity, transform: [{ scale }] }]}>
                {size > 0 &&
                    points.map((point, index) => (
                        <Animated.View
                            key={index}
                            style={[
                                styles.point,
                                {
                                    width: point.diameter,
                                    height: point.diameter,
                                    left: (size - point.diameter) / 2,
                                    top: (size - point.diameter) / 2,
                                    opacity: point.opacity,
                                    transform: [
                                        { translateX: isMotionAllowed ? point.x : point.origin.x * size },
                                        { translateY: isMotionAllowed ? point.y : point.origin.y * size },
                                    ],
                                },
                            ]}
                        />
                    ))}
            </Animated.View>
        </View>
    );
};

export default SceneVisual;
