import { AppState } from 'react-native';
import { createNativePlayer } from './native';
import { scenes } from './catalog';

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
        expect(module.loadScene).toHaveBeenCalledWith(scenes[0].json);
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
