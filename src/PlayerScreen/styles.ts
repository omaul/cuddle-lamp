import { StyleSheet } from 'react-native';
import { colors } from '../theme';

export default StyleSheet.create({
    scroll: { padding: 20 },
    content: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 16 },
    hero: { backgroundColor: colors.surface, borderRadius: 28, padding: 24, gap: 16 },
    title: { color: colors.text, fontSize: 38, fontWeight: '700' },
    heading: { color: colors.text, fontSize: 22, fontWeight: '600' },
    secondary: { color: colors.secondary, fontSize: 16 },
    error: { color: colors.error, fontSize: 16 },
    meter: { height: 4, borderRadius: 2, backgroundColor: colors.background, overflow: 'hidden' },
    meterFill: { height: '100%', backgroundColor: colors.accent },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    input: {
        color: colors.secondary, backgroundColor: colors.surface, padding: 16,
        borderRadius: 16, minHeight: 100, maxHeight: 220, textAlignVertical: 'top',
    },
});
