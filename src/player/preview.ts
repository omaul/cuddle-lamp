import { getInitialKnobs, scenes, snapKnobPosition } from './catalog';
import type { Player, PlayerSnapshot, PlayerStatus } from './Player';
import { createPlayerPreferences } from './preferences';

const PAUSE_FADE_MILLISECONDS = 1500;
const PREVIEW_TIMER_FADE_MILLISECONDS = 2000;
const LEVEL_BY_STATUS: Record<PlayerStatus, number> = {
    loading: 0,
    paused: 0,
    playing: 0.12,
    fading: 0.04,
    error: 0,
};

export function createPreviewPlayer(preferences = createPlayerPreferences()): Player & { setScenario(status: PlayerStatus): void } {
    const listeners = new Set<() => void>();
    let loadedScene = preferences.getLastScene() ?? scenes[0];
    let snapshot: PlayerSnapshot = {
        status: 'paused',
        sceneId: loadedScene.id,
        knobs: { ...getInitialKnobs(loadedScene), ...preferences.getKnobs(loadedScene) },
        remainingSeconds: null,
        rms: 0,
    };
    let timerDeadline: number | null = null;
    let timerMilliseconds: number | null = null;
    let fadeDeadline: number | null = null;
    let volume = 1;
    let interval: ReturnType<typeof setInterval> | undefined;

    const update = (fields: Partial<PlayerSnapshot>) => {
        snapshot = { ...snapshot, ...fields };
        listeners.forEach(listener => listener());
    };

    const tick = () => {
        const now = Date.now();
        if (fadeDeadline !== null && now >= fadeDeadline) {
            fadeDeadline = null;
            update({ status: 'paused', rms: 0 });
        } else if (timerDeadline !== null) {
            timerMilliseconds = Math.max(0, timerDeadline - now);
            const remainingSeconds = Math.ceil(timerMilliseconds / 1000);
            if (timerMilliseconds === 0) {
                const expiresAt = timerDeadline + PREVIEW_TIMER_FADE_MILLISECONDS;
                timerDeadline = null;
                timerMilliseconds = null;
                if (now >= expiresAt) {
                    update({ status: 'paused', remainingSeconds: null, rms: 0 });
                } else {
                    fadeDeadline = expiresAt;
                    update({ status: 'fading', remainingSeconds: null, rms: 0.04 * volume });
                }
            } else if (remainingSeconds !== snapshot.remainingSeconds) {
                update({ remainingSeconds });
            }
        }
    };

    return {
        getSnapshot() {
            return snapshot;
        },
        subscribe(listener) {
            listeners.add(listener);
            interval ??= setInterval(tick, 100);
            tick();
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) {
                    clearInterval(interval);
                    interval = undefined;
                }
            };
        },
        async loadScene(scene) {
            const canContinue = snapshot.status === 'playing' || snapshot.status === 'fading';
            loadedScene = scene;
            preferences.rememberScene(scene);
            update({
                sceneId: scene.id,
                knobs: { ...getInitialKnobs(scene), ...preferences.getKnobs(scene) },
                status: canContinue ? snapshot.status : 'paused',
                error: undefined,
            });
        },
        async setPlaying(isPlaying) {
            if (!snapshot.sceneId || snapshot.status === 'error' || snapshot.status === 'loading') {
                throw new Error('Сцена пока недоступна');
            }
            tick();
            const now = Date.now();
            if (isPlaying) {
                fadeDeadline = null;
                timerDeadline = timerMilliseconds === null ? null : now + timerMilliseconds;
                update({ status: 'playing', rms: 0.12 * volume });
            } else if (snapshot.status === 'playing' || snapshot.status === 'fading') {
                timerDeadline = null;
                fadeDeadline = now + PAUSE_FADE_MILLISECONDS;
                update({ status: 'fading', rms: 0.04 * volume });
            }
        },
        async setKnob(sceneId, knobId, value) {
            if (!Number.isFinite(value)) {
                throw new Error('Положение ручки должно быть конечным числом');
            }
            if (snapshot.sceneId !== sceneId) {
                throw new Error('Сцена сменилась во время настройки');
            }
            if (!Object.hasOwn(snapshot.knobs, knobId)) {
                throw new Error('Ручка отсутствует в выбранной сцене');
            }
            const choices = loadedScene.knobs?.find(knob => knob.id === knobId)?.choices;
            const position = snapKnobPosition(Math.max(0, Math.min(value, 1)), choices);
            preferences.rememberKnob(loadedScene, knobId, position);
            update({ knobs: { ...snapshot.knobs, [knobId]: position } });
        },
        async resetKnobs(sceneId) {
            if (snapshot.sceneId !== sceneId) {
                throw new Error('Сцена сменилась во время настройки');
            }
            preferences.forgetKnobs(loadedScene);
            update({ knobs: getInitialKnobs(loadedScene) });
        },
        async setTimer(seconds) {
            tick();
            timerMilliseconds = seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
            timerDeadline = snapshot.status === 'playing' && timerMilliseconds !== null ? Date.now() + timerMilliseconds : null;
            update({ remainingSeconds: timerMilliseconds === null ? null : Math.ceil(timerMilliseconds / 1000) });
        },
        async extendTimer(seconds) {
            tick();
            if (timerMilliseconds === null || !Number.isFinite(seconds) || seconds <= 0) {
                return;
            }
            const extension = seconds * 1000;
            timerMilliseconds += extension;
            if (timerDeadline !== null) {
                timerDeadline += extension;
            }
            update({ remainingSeconds: Math.ceil(timerMilliseconds / 1000) });
        },
        async setVolume(nextVolume) {
            volume = Math.max(0, Math.min(nextVolume, 1));
            update({ rms: LEVEL_BY_STATUS[snapshot.status] * volume });
        },
        setScenario(status) {
            timerDeadline = null;
            timerMilliseconds = null;
            fadeDeadline = null;
            update({
                status,
                remainingSeconds: null,
                rms: LEVEL_BY_STATUS[status] * volume,
                error: status === 'error' ? 'Не удалось открыть сцену. Выберите сцену ещё раз.' : undefined,
            });
        },
    };
}
