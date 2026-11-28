import type { Scene } from './catalog';
import type { Player, PlayerSnapshot } from './Player';

export function createUnavailablePlayer(initialScene: Scene): Player {
    const snapshot: PlayerSnapshot = {
        status: 'error',
        sceneId: initialScene.id,
        knobs: {},
        remainingSeconds: null,
        rms: 0,
        error: 'Звуковой движок недоступен',
    };
    const reject = async () => {
        throw new Error(snapshot.error);
    };
    return {
        getSnapshot() {
            return snapshot;
        },
        subscribe() {
            return () => {};
        },
        loadScene: reject,
        setPlaying: reject,
        setKnob: reject,
        resetKnobs: reject,
        setTimer: reject,
        extendTimer: reject,
        setVolume: reject,
    };
}
