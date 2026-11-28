import React, { useState } from 'react';
import { Platform, Settings, StatusBar, View } from 'react-native';
import PlayerContainer from '../PlayerContainer';
import nativeSoundEngine from '../native/specs/NativeSoundEngine';
import { scenes } from '../player/catalog';
import { createNativePlayer } from '../player/native';
import { createPlayerPreferences } from '../player/preferences';
import { createUnavailablePlayer } from '../player/unavailable';
import styles from './styles';

const soundEngine = typeof nativeSoundEngine?.readSnapshot === 'function' ? nativeSoundEngine : null;
const PLAYER_SETTINGS_KEY = 'CuddleLampPlayerPreferences';

const App: React.FC = () => {
    const [preferences] = useState(() => createPlayerPreferences(Platform.OS === 'ios' ? {
        read() {
            return Settings.get(PLAYER_SETTINGS_KEY);
        },
        write(value) {
            Settings.set({ [PLAYER_SETTINGS_KEY]: value });
        },
    } : undefined));
    const [preview] = useState(() => {
        if (__DEV__ && !soundEngine) {
            return (require('../player/preview') as typeof import('../player/preview')).createPreviewPlayer(preferences);
        }
        return null;
    });
    const [player] = useState(() => {
        if (soundEngine) {
            return createNativePlayer(soundEngine, scenes[0], preferences);
        }
        return preview ?? createUnavailablePlayer(scenes[0]);
    });

    return (
        <View style={styles.screen}>
            <StatusBar barStyle="light-content" />
            <PlayerContainer player={player} onScenario={preview?.setScenario} />
        </View>
    );
};

export default App;
