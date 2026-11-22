import type { Scene } from './catalog';

export type PlayerStatus = 'loading' | 'paused' | 'playing' | 'fading' | 'error';

export interface PlayerSnapshot {
    status: PlayerStatus;
    sceneId: string | null;
    sceneName?: string;
    knobLabels?: readonly { id: string; name: string }[];
    knobs: Readonly<Record<string, number>>;
    remainingSeconds: number | null;
    rms: number;
    error?: string;
}

export interface Player {
    getSnapshot(): PlayerSnapshot;
    subscribe(listener: () => void): () => void;
    loadScene(scene: Scene): Promise<void>;
    setPlaying(isPlaying: boolean): Promise<void>;
    setKnob(sceneId: string, knobId: string, value: number): Promise<void>;
    setTimer(seconds: number | null): Promise<void>;
    setVolume(volume: number): Promise<void>;
}
