import React, { useState } from 'react';
import { Pressable, Text } from 'react-native';
import styles from './styles';

interface ChoiceProps {
    title: string;
    selected?: boolean;
    primary?: boolean;
    disabled?: boolean;
    onPress: () => void;
}

const Choice: React.FC<ChoiceProps> = ({ title, selected, primary, disabled, onPress }) => {
    const [isFocused, setIsFocused] = useState(false);
    const isHighlighted = selected || primary;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            focusable={!disabled}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onPress={onPress}
            style={({ pressed }) => [
                styles.button,
                isHighlighted && styles.highlighted,
                isFocused && !disabled && styles.focused,
                pressed && styles.pressed,
                disabled && styles.disabled,
            ]}
        >
            <Text style={[styles.label, isHighlighted && styles.highlightedLabel]}>{title}</Text>
        </Pressable>
    );
};

export default Choice;
