import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { getKnobChoice, type KnobChoices } from '../../player/catalog';
import styles from './styles';

interface PresetPickerProps {
    title: string;
    choices: KnobChoices;
    position: number;
    isDisabled: boolean;
    heading?: string;
    isCompact?: boolean;
    onSelect: (position: number) => void;
}

const PresetPicker: React.FC<PresetPickerProps> = ({
    title,
    choices,
    position,
    isDisabled,
    heading,
    isCompact,
    onSelect,
}) => {
    const selectedValue = getKnobChoice(choices, position);
    const suffix = choices.unit ? ` ${choices.unit}` : '';
    const groupLabel = choices.unit ? `${title}, ${choices.unit}` : title;
    const columnCount = isCompact ? 5 : 3;
    const rows = Array.from({ length: Math.ceil(choices.values.length / columnCount) }, (_, rowIndex) => {
        const first = rowIndex * columnCount;
        return choices.values.slice(first, first + columnCount);
    });

    const renderOption = (value: number, index: number) => {
        const isSelected = value === selectedValue;
        return (
            <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityLabel={`${value}${suffix}`}
                accessibilityState={{ selected: isSelected, checked: isSelected, disabled: isDisabled }}
                disabled={isDisabled}
                onPress={() => onSelect(index / (choices.values.length - 1))}
                style={({ pressed }) => [
                    styles.option,
                    isSelected && styles.selected,
                    (pressed || isDisabled) && styles.dimmed,
                ]}
            >
                <Text style={[styles.label, isSelected && styles.selectedLabel]}>{value}</Text>
            </Pressable>
        );
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text accessibilityRole={heading ? 'header' : undefined} style={styles.title}>
                    {heading ?? groupLabel}
                </Text>
                {heading && choices.unit !== '' && <Text style={styles.unit}>{choices.unit}</Text>}
            </View>
            <View accessibilityRole="radiogroup" accessibilityLabel={groupLabel} style={styles.grid}>
                {rows.map((row, rowIndex) => {
                    const isPartialRow = isCompact && row.length < columnCount;
                    const sideSpace = { flex: (columnCount - row.length) / 2 };
                    return (
                        <View key={row[0]} style={styles.row}>
                            {isPartialRow && <View style={sideSpace} />}
                            {row.map((value, columnIndex) =>
                                renderOption(value, rowIndex * columnCount + columnIndex),
                            )}
                            {isPartialRow && <View style={sideSpace} />}
                        </View>
                    );
                })}
            </View>
        </View>
    );
};

export default PresetPicker;
