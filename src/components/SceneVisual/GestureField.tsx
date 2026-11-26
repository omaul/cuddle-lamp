import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import type { SceneVisualInput } from './index';
import styles from './styles';

type Ink = 'ripple' | 'star';

interface Point {
    x: number;
    y: number;
}

interface Track extends Point {
    time: number;
    pulse?: ReturnType<typeof setInterval>;
}

interface Mark {
    id: number;
    ink: Ink;
    start: Point;
    end: Point;
    size: number;
    glintDelay?: number;
}

const MAX_MARKS = 18;
const LIFETIMES = { ripple: 2100, star: 8500 };
const RIPPLE_RADII = [0.60, 0.74, 0.86, 0.93];

interface InkMarkProps {
    mark: Mark;
    isRetiring: boolean;
    isMotionAllowed: boolean;
    onFinish: (id: number) => void;
}

const InkMark = React.memo<InkMarkProps>(({ mark, isRetiring, isMotionAllowed, onFinish }) => {
    const [progress] = useState(() => new Animated.Value(0));
    const { id, ink, start, end, size, glintDelay } = mark;
    const isGlinting = glintDelay !== undefined && isMotionAllowed;
    useEffect(() => {
        if (isGlinting && !isRetiring) progress.setValue(0);
        const animation = Animated.timing(progress, {
            toValue: 1,
            delay: isGlinting && !isRetiring ? glintDelay : 0,
            duration: isRetiring ? 450 : LIFETIMES[ink],
            easing: Easing.linear,
            useNativeDriver: true,
            isInteraction: false,
        });
        animation.start(({ finished }) => {
            if (finished) onFinish(id);
        });
        return () => animation.stop();
    }, [glintDelay, id, ink, isGlinting, isRetiring, onFinish, progress]);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const width = Math.max(size, length);
    const isStar = ink === 'star';
    const isRipple = ink === 'ripple';
    const markLeft = isStar ? (width + length - size) / 2 : 0;
    const opacity = progress.interpolate({
        inputRange: [0, 0.09, 0.65, 1],
        outputRange: [isGlinting ? 0.55 : 0.85, 1, isRipple ? 0.46 : 0.88, 0],
    });
    const scale = progress.interpolate({
        inputRange: [0, isGlinting ? 0.035 : 0.42, 1],
        outputRange: isRipple ? [0.12, 0.64, 1] : [0.88, isGlinting ? 1.9 : 1.12, 0.95],
    });
    const transform = [{ rotate: `${Math.atan2(dy, dx)}rad` }];
    const placement = {
        left: (start.x + end.x - width) / 2,
        top: (start.y + end.y - size) / 2,
        width,
        height: size,
        transform,
    };
    return (
        <View style={[styles.artwork, placement]}>
            {isStar && length > 0 && (
                <Animated.View
                    style={[styles.starLink, { width: length, left: (width - length) / 2, top: size / 2, opacity }]}
                />
            )}
            <Animated.View
                style={[
                    styles.artwork,
                    {
                        width: isStar ? size : width,
                        height: size,
                        left: markLeft,
                        opacity,
                        transform: [{ scale: isMotionAllowed ? scale : 1 }],
                    },
                ]}
            >
                {isStar ? (
                    <>
                        <View style={styles.starHalo} />
                        <View style={styles.starRay} />
                        <View style={[styles.starRay, styles.starCrossRay]} />
                    </>
                ) : (
                    RIPPLE_RADII.map((fraction, index) => {
                        const diameter = size * fraction;
                        return (
                            <View
                                key={fraction}
                                style={[
                                    styles.ripple,
                                    {
                                        left: (width - diameter) / 2,
                                        top: (size - diameter * 0.92) / 2,
                                        width: diameter,
                                        height: diameter * 0.92,
                                        borderRadius: diameter / 2,
                                        opacity: 0.85 - 0.15 * index,
                                    },
                                ]}
                            />
                        );
                    })
                )}
            </Animated.View>
        </View>
    );
});

interface GestureFieldProps {
    inputRef: React.Ref<SceneVisualInput>;
    sceneId: string | null;
    width: number;
    height: number;
    isMotionAllowed: boolean;
}

const GestureField: React.FC<GestureFieldProps> = ({ inputRef, sceneId, width, height, isMotionAllowed }) => {
    const [marks, setMarks] = useState<Mark[]>([]);
    const nextId = useRef(0);
    const tracks = useRef(new Map<number, Track>());
    const constellation = useRef<{ first: Track; firstId: number; last: Track } | null>(null);

    let ink: Ink | undefined;
    if (sceneId === 'relax') ink = 'ripple';
    if (sceneId === 'sleep') ink = 'star';

    const addMark = useCallback((kind: Ink, start: Point, end: Point, size: number) => {
        const mark = { id: ++nextId.current, ink: kind, start, end, size };
        setMarks((prev) => [...prev.slice(1 - MAX_MARKS), mark]);
        return mark.id;
    }, []);
    const removeMark = useCallback((id: number) => {
        setMarks((prev) => prev.filter((mark) => mark.id !== id));
    }, []);
    const release = useCallback((identifier: number) => {
        clearInterval(tracks.current.get(identifier)?.pulse);
        tracks.current.delete(identifier);
    }, []);

    useLayoutEffect(() => {
        const active = tracks.current;
        constellation.current = null;
        return () => {
            for (const track of active.values()) clearInterval(track.pulse);
            active.clear();
        };
    }, [sceneId, isMotionAllowed, width, height]);

    useImperativeHandle(
        inputRef,
        () => ({
            handleTouches: ({ nativeEvent }, area) => {
                if (!ink) return;
                const now = Date.now();
                for (const { identifier, pageX: x, pageY: y, locationX, locationY } of nativeEvent.changedTouches) {
                    if (locationX < 0 || locationX > area.width || locationY < 0 || locationY > area.height) {
                        release(identifier);
                        continue;
                    }
                    const point = { x, y };
                    const prev = tracks.current.get(identifier);
                    const distance = prev ? Math.hypot(x - prev.x, y - prev.y) : 0;
                    const spacing = ink === 'star' ? 46 : 23;
                    if (prev && (distance < spacing || now - prev.time < 50)) continue;
                    const track: Track = { ...point, time: now, pulse: prev?.pulse };
                    tracks.current.set(identifier, track);

                    if (ink === 'ripple') {
                        addMark(ink, point, point, prev ? 100 : 154);
                        if (!prev && isMotionAllowed) {
                            track.pulse = setInterval(() => {
                                const held = tracks.current.get(identifier);
                                if (held && Date.now() - held.time > 450) {
                                    const diameter = Math.min(245, 150 + (Date.now() - held.time) / 35);
                                    addMark('ripple', held, held, diameter);
                                }
                            }, 680);
                        }
                    } else {
                        const chain = constellation.current;
                        const isOpen =
                            chain !== null &&
                            now - chain.last.time < 4200 &&
                            now - chain.first.time < 7400 &&
                            nextId.current - chain.firstId < MAX_MARKS - 1;
                        const isClosed =
                            isOpen &&
                            nextId.current - chain.firstId >= 2 &&
                            Math.hypot(x - chain.first.x, y - chain.first.y) < 24 &&
                            Math.hypot(x - chain.last.x, y - chain.last.y) > 30;
                        const starSize = 15 + 6 * (1 + Math.sin(nextId.current * 2.4));
                        const id = addMark(ink, isOpen ? chain.last : point, isClosed ? chain.first : point, starSize);
                        if (isClosed) {
                            constellation.current = null;
                            setMarks((items) =>
                                items.map((item) =>
                                    item.id >= chain.firstId && item.id <= id
                                        ? { ...item, glintDelay: (item.id - chain.firstId) * 75 }
                                        : item,
                                ),
                            );
                        } else if (isOpen) {
                            chain.last = track;
                        } else {
                            constellation.current = { first: track, firstId: id, last: track };
                        }
                    }
                }
            },
            handleTouchEnd: ({ nativeEvent }) => {
                for (const { identifier } of nativeEvent.changedTouches) release(identifier);
            },
        }),
        [addMark, ink, isMotionAllowed, release],
    );

    return marks.map((mark) => (
        <InkMark
            key={mark.id}
            mark={mark}
            isRetiring={mark.ink !== ink}
            isMotionAllowed={isMotionAllowed}
            onFinish={removeMark}
        />
    ));
};

export default GestureField;
