import { StyleSheet } from 'react-native';
import { colors } from '../../theme';

const styles = StyleSheet.create({
    container: { gap: 8, padding: 12 },
    header: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 8,
        paddingHorizontal: 4,
    },
    title: {
        color: colors.text,
        fontSize: 16,
        fontWeight: '600',
        flexShrink: 1,
    },
    unit: { color: colors.secondary, fontSize: 14 },
    grid: {
        gap: 4,
        padding: 4,
        borderRadius: 16,
        backgroundColor: colors.input,
    },
    row: { flexDirection: 'row', gap: 4 },
    option: {
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minHeight: 44,
        paddingHorizontal: 4,
        paddingVertical: 4,
        borderRadius: 12,
        backgroundColor: colors.surface,
    },
    selected: {
        backgroundColor: '#3d2c24',
    },
    label: {
        color: colors.text,
        fontSize: 16,
        fontVariant: ['tabular-nums'],
    },
    selectedLabel: {
        color: colors.accent,
        fontWeight: '600',
    },
    dimmed: { opacity: 0.6 },
});

export default styles;
