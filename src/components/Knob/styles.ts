import { StyleSheet } from 'react-native';
import { colors } from '../../theme';

export default StyleSheet.create({
    dial: { alignSelf: 'center' },
    face: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 46,
        backgroundColor: colors.input,
    },
    tick: { position: 'absolute', width: 2, height: 6, borderRadius: 1, backgroundColor: colors.border },
    activeTick: { backgroundColor: colors.accent },
    indicator: { width: 3 },
    value: { color: colors.text, fontSize: 23, fontWeight: '600', fontVariant: ['tabular-nums'], maxWidth: 53 },
});
