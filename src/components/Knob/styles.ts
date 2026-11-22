import { StyleSheet } from 'react-native';
import { colors } from '../../theme';

export default StyleSheet.create({
    card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 12 },
    label: { color: colors.text, fontSize: 18 },
    railTarget: { minHeight: 48, justifyContent: 'center' },
    rail: { height: 8, borderRadius: 4, backgroundColor: colors.background, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 4, backgroundColor: colors.accent },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
