import React, { useState } from 'react';
import { Platform, SafeAreaView, StatusBar, View } from 'react-native';
import PlayerContainer from '../PlayerContainer';
import nativeSoundEngine from '../native/specs/NativeSoundEngine';
import { scenes } from '../player/catalog';
import { createNativePlayer } from '../player/native';
import { createUnavailablePlayer } from '../player/unavailable';
import styles from './styles';

const soundEngine = typeof nativeSoundEngine?.readSnapshot === 'function' ? nativeSoundEngine : null;

const App: React.FC = () => {
    const [preview] = useState(() => {
        if (__DEV__ && !soundEngine) {
            return (require('../player/preview') as typeof import('../player/preview')).createPreviewPlayer();
        }
        return null;
    });
    const [player] = useState(() => {
        if (soundEngine) {
            return createNativePlayer(soundEngine, scenes[0]);
        }
        return preview ?? createUnavailablePlayer(scenes[0]);
    });
    const Screen = Platform.OS === 'ios' ? SafeAreaView : View;

    return (
        <Screen style={styles.screen}>
            <StatusBar barStyle="light-content" />
            <PlayerContainer player={player} onScenario={preview?.setScenario} />
        </Screen>
    );
};

export default App;
