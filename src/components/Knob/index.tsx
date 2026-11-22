import React, { useRef, useState } from 'react';
import { I18nManager, Text, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import Choice from '../Choice';
import styles from './styles';

interface KnobProps {
    title: string;
    value: number;
    disabled?: boolean;
    onChange: (value: number) => void;
}

const Knob: React.FC<KnobProps> = ({ title, value, disabled, onChange }) => {
    const railWidth = useRef(0);
    const [draft, setDraft] = useState<number>();
    const percent = Math.round((draft ?? value) * 100);

    const getGestureValue = (event: GestureResponderEvent) => {
        const position = Math.max(0, Math.min(1, event.nativeEvent.locationX / railWidth.current));
        return I18nManager.isRTL ? 1 - position : position;
    };

    const handleStep = (step: number) => {
        onChange(Math.max(0, Math.min(100, percent + step)) / 100);
    };

    return (
        <View style={styles.card}>
            <View
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={title}
                accessibilityValue={{ min: 0, max: 100, now: percent }}
                accessibilityState={{ disabled }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={({ nativeEvent }) => {
                    if (!disabled && nativeEvent.actionName === 'increment') {
                        handleStep(5);
                    } else if (!disabled && nativeEvent.actionName === 'decrement') {
                        handleStep(-5);
                    }
                }}
            >
                <Text style={styles.label}>{title} · {percent}%</Text>
                <View
                    style={styles.railTarget}
                    onLayout={({ nativeEvent }) => { railWidth.current = nativeEvent.layout.width; }}
                    onStartShouldSetResponder={() => !disabled && railWidth.current > 0}
                    onResponderGrant={event => setDraft(getGestureValue(event))}
                    onResponderMove={event => setDraft(getGestureValue(event))}
                    onResponderRelease={event => {
                        setDraft(undefined);
                        if (!disabled) {
                            onChange(getGestureValue(event));
                        }
                    }}
                    onResponderTerminate={() => setDraft(undefined)}
                >
                    <View pointerEvents="none" style={styles.rail}>
                        <View style={[styles.fill, { width: `${percent}%` }]} />
                    </View>
                </View>
            </View>
            <View style={styles.actions}>
                <Choice title={`Уменьшить ${title.toLowerCase()}`} disabled={disabled || percent === 0} onPress={() => handleStep(-5)} />
                <Choice title={`Увеличить ${title.toLowerCase()}`} disabled={disabled || percent === 100} onPress={() => handleStep(5)} />
            </View>
        </View>
    );
};

export default Knob;
