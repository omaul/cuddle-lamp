import React, { useRef, useState, useSyncExternalStore } from 'react';
import PlayerScreen from '../PlayerScreen';
import { readSceneMetadata, scenes } from '../player/catalog';
import type { Scene } from '../player/catalog';
import type { Player, PlayerStatus } from '../player/Player';

interface PlayerContainerProps {
    player: Player;
    onScenario?: (status: PlayerStatus) => void;
}

const PlayerContainer: React.FC<PlayerContainerProps> = ({ player, onScenario }) => {
    const snapshot = useSyncExternalStore(player.subscribe, player.getSnapshot);
    const [error, setError] = useState<string>();
    const [catalog, setCatalog] = useState<readonly Scene[]>(scenes);
    const commandVersion = useRef(0);

    const handleCommand = async (command: () => Promise<void>) => {
        const version = ++commandVersion.current;
        setError(undefined);
        try {
            await command();
        } catch (reason) {
            if (version === commandVersion.current) {
                setError(reason instanceof Error ? reason.message : 'Не удалось выполнить команду');
            }
        }
    };

    const handleScenario = onScenario ? (status: PlayerStatus) => {
        commandVersion.current += 1;
        setError(undefined);
        onScenario(status);
    } : undefined;

    const handleImport = (json: string) => {
        void handleCommand(async () => {
            let scene: Scene;
            try {
                scene = readSceneMetadata(json);
            } catch (reason) {
                throw reason instanceof SyntaxError ? new Error('Не удалось прочитать JSON сцены') : reason;
            }
            await player.loadScene(scene);
            setCatalog(items => {
                if (items.some(item => item.id === scene.id)) {
                    return items.map(item => item.id === scene.id ? scene : item);
                }
                return [...items, scene];
            });
        });
    };

    return (
        <PlayerScreen
            scenes={catalog}
            snapshot={snapshot}
            error={error ?? snapshot.error}
            onScene={scene => { void handleCommand(() => player.loadScene(scene)); }}
            onPlaying={isPlaying => { void handleCommand(() => player.setPlaying(isPlaying)); }}
            onKnob={(id, value) => {
                if (snapshot.sceneId !== null) {
                    const sceneId = snapshot.sceneId;
                    void handleCommand(() => player.setKnob(sceneId, id, value));
                }
            }}
            onResetKnobs={() => {
                if (snapshot.sceneId !== null) {
                    const sceneId = snapshot.sceneId;
                    handleCommand(() => player.resetKnobs(sceneId));
                }
            }}
            onTimer={seconds => { void handleCommand(() => player.setTimer(seconds)); }}
            onExtendTimer={seconds => { handleCommand(() => player.extendTimer(seconds)); }}
            onScenario={handleScenario}
            onImport={__DEV__ && !onScenario ? handleImport : undefined}
        />
    );
};

export default PlayerContainer;
