import { AppState } from 'react-native';
import { createNativePlayer } from './native';
import { getInitialKnobs, readSceneMetadata, scenes } from './catalog';
import { createPlayerPreferences } from './preferences';

jest.mock('react-native', () => ({
    AppState: { currentState: 'active', addEventListener: jest.fn() },
}));

test('при возврате на экран загружает сцену после временного сбоя чтения', async () => {
    jest.useFakeTimers();
    const remove = jest.fn();
    let activate;
    AppState.addEventListener.mockImplementation((_event, listener) => {
        activate = listener;
        return { remove };
    });
    let isAvailable = false;
    const engine = { status: 0, scene: null, remainingSeconds: null, rms: 0, appliedCommand: 0 };
    const module = {
        readSnapshot() {
            if (!isAvailable) {
                throw new Error('Движок недоступен');
            }
            return JSON.stringify(engine);
        },
        loadScene: jest.fn(() => {
            engine.status = 1;
            engine.scene = { sceneId: scenes[0].id, name: scenes[0].name, knobs: {} };
            engine.appliedCommand = 1;
            return 1;
        }),
    };
    const player = createNativePlayer(module, scenes[0]);
    const unsubscribe = player.subscribe(() => {});
    try {
        expect(player.getSnapshot().status).toBe('error');
        isAvailable = true;
        activate('active');
        await Promise.resolve();
        expect(module.loadScene).toHaveBeenCalledWith(scenes[0].json, '{}');
        expect(player.getSnapshot()).toMatchObject({
            status: 'paused',
            sceneId: scenes[0].id,
            sceneName: scenes[0].name,
        });
    } finally {
        unsubscribe();
        jest.useRealTimers();
    }
    expect(remove).toHaveBeenCalledTimes(1);
});

test('восстанавливает встроенные сцены на паузе и сбрасывает ручки только у открытой сцены', async () => {
    AppState.addEventListener.mockReturnValue({ remove() {} });
    const focus = scenes.find(scene => scene.id === 'focus');
    const sleep = scenes.find(scene => scene.id === 'sleep');
    let storedValue;
    const storage = {
        read: () => storedValue,
        write: value => { storedValue = value; },
    };
    const openPlayer = async () => {
        const engine = { status: 0, scene: null, remainingSeconds: null, rms: 0, appliedCommand: 0 };
        let defaults;
        const module = {
            readSnapshot: () => JSON.stringify(engine),
            loadScene(json, knobsJson) {
                const scene = readSceneMetadata(json);
                defaults = getInitialKnobs(scene);
                engine.status ||= 1;
                engine.scene = { sceneId: scene.id, name: scene.name, knobs: { ...defaults, ...JSON.parse(knobsJson) } };
                return ++engine.appliedCommand;
            },
            setKnob(sceneId, knobId, value) {
                expect(engine.scene.sceneId).toBe(sceneId);
                engine.scene.knobs[knobId] = value;
                return ++engine.appliedCommand;
            },
            resetKnobs(sceneId) {
                expect(engine.scene.sceneId).toBe(sceneId);
                engine.scene.knobs = { ...defaults };
                return ++engine.appliedCommand;
            },
        };
        const player = createNativePlayer(module, focus, createPlayerPreferences(storage));
        const unsubscribe = player.subscribe(() => {});
        await Promise.resolve();
        unsubscribe();
        return player;
    };

    const first = await openPlayer();
    await first.loadScene(sleep);
    await first.setKnob(sleep.id, 'density', 0);
    await first.loadScene(focus);
    await first.setKnob(focus.id, 'brightness', 1);
    const imported = readSceneMetadata(focus.json);
    await first.loadScene(imported);
    await first.setKnob(imported.id, 'brightness', 0);

    const second = await openPlayer();
    expect(second.getSnapshot()).toMatchObject({ status: 'paused', sceneId: focus.id, knobs: { brightness: 1 } });
    await second.loadScene(sleep);
    expect(second.getSnapshot().knobs.density).toBe(0);
    await second.resetKnobs(sleep.id);
    expect(second.getSnapshot().knobs).toEqual(getInitialKnobs(sleep));
    const third = await openPlayer();
    expect(third.getSnapshot()).toMatchObject({ status: 'paused', sceneId: sleep.id, knobs: getInitialKnobs(sleep) });
    await third.loadScene(focus);
    expect(third.getSnapshot().knobs.brightness).toBe(1);
});
