import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import styles from './styles';

interface KnobProps {
    title: string;
    value: number;
    disabled?: boolean;
    onChange: (value: number) => void;
}

const DIAL_SIZE = 92;
const SWEEP = (270 * Math.PI) / 180;
const TICKS = Array.from({ length: 25 }, (_, index) => {
    const angle = (index / 24 - 0.5) * SWEEP;
    return {
        left: DIAL_SIZE / 2 + 40 * Math.sin(angle) - 1,
        top: DIAL_SIZE / 2 - 40 * Math.cos(angle) - 3,
        transform: [{ rotate: `${angle}rad` }],
    };
});

const Knob: React.FC<KnobProps> = ({ title, value, disabled, onChange }) => {
    const gesture = useRef<{
        centerX: number;
        centerY: number;
        angle: number | null;
        value: number;
        hasMoved: boolean;
    } | null>(null);
    const [draft, setDraft] = useState<number>();
    const percent = Math.round((draft ?? value) * 100);

    const handleStart = ({ nativeEvent }: GestureResponderEvent) => {
        const { pageX, pageY, locationX, locationY } = nativeEvent;
        gesture.current = {
            centerX: pageX - locationX + DIAL_SIZE / 2,
            centerY: pageY - locationY + DIAL_SIZE / 2,
            angle: null,
            value,
            hasMoved: false,
        };
        handleMove({ nativeEvent });
    };

    const handleMove = ({ nativeEvent }: Pick<GestureResponderEvent, 'nativeEvent'>) => {
        const current = gesture.current;
        if (!current) {
            return;
        }
        const x = nativeEvent.pageX - current.centerX;
        const y = nativeEvent.pageY - current.centerY;
        if (Math.hypot(x, y) < 12) {
            current.angle = null;
            return;
        }
        const angle = Math.atan2(x, -y);
        if (current.angle !== null) {
            const delta = angle - current.angle;
            const distance = Math.atan2(Math.sin(delta), Math.cos(delta));
            current.hasMoved = true;
            current.value = Math.max(0, Math.min(1, current.value + distance / SWEEP));
            setDraft(current.value);
        }
        current.angle = angle;
    };

    const handleEnd = () => {
        const current = gesture.current;
        let next = current?.value;
        if (current && !current.hasMoved && current.angle !== null) {
            next = Math.max(0, Math.min(1, 0.5 + current.angle / SWEEP));
        }
        gesture.current = null;
        setDraft(undefined);
        if (!disabled && next !== undefined && next !== value) {
            onChange(next);
        }
    };

    return (
        <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={title}
            accessibilityHint="Смахните вверх или вниз, чтобы изменить значение"
            accessibilityValue={{ min: 0, max: 100, now: percent }}
            accessibilityState={{ disabled }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={({ nativeEvent }) => {
                if (!disabled) {
                    const step = nativeEvent.actionName === 'increment' ? 5 : -5;
                    onChange(Math.max(0, Math.min(100, percent + step)) / 100);
                }
            }}
            onStartShouldSetResponder={() => !disabled}
            onResponderGrant={handleStart}
            onResponderMove={handleMove}
            onResponderRelease={handleEnd}
            onResponderTerminationRequest={() => false}
            onResponderTerminate={() => {
                gesture.current = null;
                setDraft(undefined);
            }}
            style={[styles.dial, { width: DIAL_SIZE, height: DIAL_SIZE }]}
        >
            <View pointerEvents="none" style={styles.face}>
                {TICKS.map((tick, index) => (
                    <View
                        key={index}
                        style={[
                            styles.tick,
                            tick,
                            index / 24 <= percent / 100 && styles.activeTick,
                            index === Math.round((percent / 100) * 24) && styles.indicator,
                        ]}
                    />
                ))}
                <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
                    {percent}%
                </Text>
            </View>
        </View>
    );
};

export default Knob;
