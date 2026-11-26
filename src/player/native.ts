import { AppState } from 'react-native';
import type { Scene } from './catalog';
import type { Player, PlayerSnapshot, PlayerStatus } from './Player';
import type { Spec } from '../native/specs/NativeSoundEngine';

interface EngineSnapshot {
    status: 0 | 1 | 2 | 3;
    remainingSeconds: number | null;
    rms: number;
    bells?: PlayerSnapshot['bells'];
    appliedCommand: number;
    scene: { sceneId: string; name: string; knobLabels?: PlayerSnapshot['knobLabels']; knobs: Record<string, number> } | null;
}

const STATUS_BY_CODE: readonly PlayerStatus[] = ['loading', 'paused', 'playing', 'fading'];
const REFRESH_MILLISECONDS = 125;
const COMMAND_TIMEOUT_MILLISECONDS = 3000;

export function createNativePlayer(module: Spec, initialScene: Scene): Player {
    let snapshot: PlayerSnapshot = {
        status: 'loading',
        sceneId: null,
        knobs: {},
        remainingSeconds: null,
        rms: 0,
    };
    let commands: Promise<void> = Promise.resolve();
    let interval: ReturnType<typeof setInterval> | undefined;
    let appStateSubscription: ReturnType<typeof AppState.addEventListener> | undefined;
    let latestJson: string | undefined;
    let latestEngine: EngineSnapshot | undefined;
    let hasRequestedInitialScene = false;
    let initialSceneError: string | undefined;
    let hasReadError = false;
    const listeners = new Set<() => void>();

    const update = (next: PlayerSnapshot) => {
        snapshot = next;
        listeners.forEach(listener => listener());
    };

    const refresh = (): EngineSnapshot => {
        const json = module.readSnapshot();
        if (latestEngine && latestJson === json && !hasReadError && snapshot.error === initialSceneError) {
            return latestEngine;
        }
        const engine = JSON.parse(json) as EngineSnapshot;
        latestJson = json;
        latestEngine = engine;
        hasReadError = false;
        if (engine.scene) {
            initialSceneError = undefined;
        }
        update({
            status: initialSceneError ? 'error' : STATUS_BY_CODE[engine.status],
            sceneId: engine.scene?.sceneId ?? null,
            sceneName: engine.scene?.name,
            knobLabels: engine.scene?.knobLabels,
            knobs: engine.scene?.knobs ?? {},
            remainingSeconds: engine.remainingSeconds === null ? null : Math.ceil(engine.remainingSeconds),
            rms: engine.rms,
            bells: engine.bells,
            error: initialSceneError,
        });
        return engine;
    };

    const refreshSafely = (): boolean => {
        try {
            refresh();
            return true;
        } catch (reason) {
            hasReadError = true;
            const error = reason instanceof Error ? reason.message : 'Движок недоступен';
            if (snapshot.status !== 'error' || snapshot.error !== error) {
                update({ ...snapshot, status: 'error', rms: 0, error });
            }
            return false;
        }
    };

    const enqueue = (submit: () => number | void): Promise<void> => {
        const pending = commands.then(async () => {
            const sequence = submit();
            if (sequence === undefined) {
                refresh();
                return;
            }

            const deadline = Date.now() + COMMAND_TIMEOUT_MILLISECONDS;
            while (true) {
                const { appliedCommand } = refresh();
                if (((appliedCommand - sequence) >>> 0) < 0x80000000) {
                    return;
                }
                if (Date.now() >= deadline) {
                    throw new Error('Движок не подтвердил команду');
                }
                await new Promise<void>(resolve => setTimeout(resolve, 30));
            }
        });
        commands = pending.catch(() => {});
        return pending;
    };

    const loadScene = async (scene: Scene) => {
        hasRequestedInitialScene = true;
        initialSceneError = undefined;
        await enqueue(() => module.loadScene(scene.json));
    };

    const syncPlayer = () => {
        if (refreshSafely() && !hasRequestedInitialScene && snapshot.status === 'loading') {
            void loadScene(initialScene).catch(reason => {
                if (!snapshot.sceneId) {
                    initialSceneError = reason instanceof Error ? reason.message : 'Сцена недоступна';
                    update({ ...snapshot, status: 'error', rms: 0, error: initialSceneError });
                }
            });
        }
    };

    return {
        getSnapshot() {
            return snapshot;
        },
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
                syncPlayer();
                interval = setInterval(() => {
                    if (AppState.currentState === 'active') {
                        syncPlayer();
                    }
                }, REFRESH_MILLISECONDS);
                appStateSubscription = AppState.addEventListener('change', status => {
                    if (status === 'active') {
                        syncPlayer();
                    }
                });
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) {
                    appStateSubscription?.remove();
                    appStateSubscription = undefined;
                    clearInterval(interval);
                    interval = undefined;
                }
            };
        },
        loadScene,
        setPlaying(isPlaying) {
            return enqueue(() => module.setPlaying(isPlaying));
        },
        setKnob(sceneId, knobId, value) {
            return enqueue(() => module.setKnob(sceneId, knobId, value));
        },
        setTimer(seconds) {
            return enqueue(() => module.setTimer(seconds ?? 0));
        },
        setVolume(volume) {
            return enqueue(() => module.setVolume(volume));
        },
    };
}
