import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, Platform, View, type GestureResponderEvent } from 'react-native';
import type { BellNote } from '../../player/Player';
import GestureField from './GestureField';
import SceneArtwork from './SceneArtwork';
import styles from './styles';

export interface SceneVisualInput {
    handleTouches: (event: GestureResponderEvent, area: { width: number; height: number }) => void;
    handleTouchEnd: (event: GestureResponderEvent) => void;
}

interface SceneVisualProps {
    sceneId: string | null;
    isPlaying: boolean;
    rms: number;
    bells?: readonly BellNote[];
    space: number;
    inputRef: React.Ref<SceneVisualInput>;
}

export interface SceneArtworkProps extends Omit<SceneVisualProps, 'inputRef'> {
    width: number;
    height: number;
    isMotionAllowed: boolean;
    localMinute: number;
}

export interface SceneImpulse {
    x: number;
    y: number;
    strength: number;
}

const SceneVisual: React.FC<SceneVisualProps> = ({ sceneId, isPlaying, rms, bells, space, inputRef }) => {
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [isForeground, setIsForeground] = useState(
        AppState.currentState === 'active' || AppState.currentState === null,
    );
    const [isMotionAllowed, setIsMotionAllowed] = useState(false);

    const [localMinute, setLocalMinute] = useState(0);

    useEffect(() => {
        if (Platform.OS !== 'ios' || sceneId !== 'focus' || !isForeground) return;
        let timer: ReturnType<typeof setTimeout>;
        const updateTime = () => {
            const now = new Date();
            setLocalMinute(now.getHours() * 60 + now.getMinutes());
            timer = setTimeout(updateTime, 60000 - now.getSeconds() * 1000 - now.getMilliseconds());
        };
        updateTime();
        return () => clearTimeout(timer);
    }, [isForeground, sceneId]);

    useEffect(() => {
        let isMounted = true;
        let hasPreferenceChanged = false;
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
        const app = AppState.addEventListener('change', (state) => {
            setIsForeground(state === 'active');
        });
        return () => {
            isMounted = false;
            preference.remove();
            app.remove();
        };
    }, []);

    return (
        <View
            pointerEvents={Platform.OS === 'ios' && sceneId === 'relax' ? 'box-none' : 'none'}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.canvas}
            onLayout={({ nativeEvent }) => {
                const { width, height } = nativeEvent.layout;
                setSize({ width, height });
            }}
        >
            {sceneId !== null && (sceneId !== 'focus' || Platform.OS === 'ios') && size.width > 0 && size.height > 0 && (
                <SceneArtwork
                    {...size}
                    {...{ sceneId, isPlaying, rms, bells, space, localMinute }}
                    isMotionAllowed={isForeground && isMotionAllowed}
                />
            )}
            {isForeground && size.width > 0 && size.height > 0 && (
                <GestureField {...size} {...{ inputRef, sceneId, isMotionAllowed }} />
            )}
        </View>
    );
};

export default SceneVisual;
