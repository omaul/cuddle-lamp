import { StyleSheet } from 'react-native';
import { colors } from '../../theme';

export default StyleSheet.create({
    canvas: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    artwork: { position: 'relative', marginBottom: '18%' },
    point: { position: 'absolute', borderRadius: 4, backgroundColor: colors.signal },
});
