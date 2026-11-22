import { createPreviewPlayer } from './preview';

afterEach(() => {
    jest.useRealTimers();
});

test('таймер сохраняет остаток при паузе и продолжает отсчёт после возобновления', async () => {
    jest.useFakeTimers();
    const player = createPreviewPlayer();
    const unsubscribe = player.subscribe(() => {});

    await player.setTimer(5);
    await player.setPlaying(true);
    jest.advanceTimersByTime(1250);
    await player.setPlaying(false);
    expect(player.getSnapshot()).toMatchObject({ status: 'fading', remainingSeconds: 4 });
    jest.advanceTimersByTime(2500);
    expect(player.getSnapshot()).toMatchObject({ status: 'paused', remainingSeconds: 4 });

    await player.setPlaying(true);
    jest.advanceTimersByTime(3700);
    expect(player.getSnapshot()).toMatchObject({ status: 'playing', remainingSeconds: 1 });
    jest.advanceTimersByTime(100);
    expect(player.getSnapshot()).toMatchObject({ status: 'fading', remainingSeconds: null });
    jest.advanceTimersByTime(2000);
    expect(player.getSnapshot().status).toBe('paused');
    unsubscribe();
});
