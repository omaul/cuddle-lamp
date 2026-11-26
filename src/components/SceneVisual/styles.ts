import { StyleSheet } from 'react-native';

export default StyleSheet.create({
    canvas: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: 'hidden',
    },
    artwork: { position: 'absolute' },
    point: { position: 'absolute', borderRadius: 4, backgroundColor: '#c2d6f7' },
    ripple: {
        position: 'absolute',
        borderWidth: 1,
        borderColor: '#ffc4a3',
        borderLeftColor: '#c98e9888',
        borderBottomColor: '#cd999266',
    },
    starHalo: {
        width: '100%',
        height: '100%',
        backgroundImage: 'radial-gradient(circle, #cce1ff99 0%, #9dc6ff00 65%)',
    },
    starRay: {
        position: 'absolute',
        left: '43%',
        top: '17%',
        width: '14%',
        height: '66%',
        borderRadius: '50%',
        backgroundColor: '#eef1ff',
    },
    starCrossRay: { transform: [{ rotate: '90deg' }, { scaleY: 0.8 }] },
    starLink: { position: 'absolute', height: 1, backgroundColor: '#acbdde88' },
});
