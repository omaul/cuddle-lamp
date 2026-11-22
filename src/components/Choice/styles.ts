import { StyleSheet } from 'react-native';
import { colors } from '../../theme';

export default StyleSheet.create({
    button: {
        minHeight: 48, minWidth: 48, maxWidth: '100%', justifyContent: 'center',
        alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16,
        borderRadius: 16, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.secondary,
    },
    highlighted: { backgroundColor: colors.accent, borderColor: colors.accent },
    focused: { borderColor: colors.text },
    pressed: { opacity: 0.82 },
    disabled: { opacity: 0.55 },
    label: { color: colors.text, fontSize: 16 },
    highlightedLabel: { color: colors.ink, fontWeight: '600' },
});
