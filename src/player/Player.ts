import type { KnobLabel, Scene } from './catalog';

export type PlayerStatus = 'loading' | 'paused' | 'playing' | 'fading' | 'error';

export interface BellNote {
    midi: number;
    level: number;
}

export interface PlayerSnapshot {
    status: PlayerStatus;
    sceneId: string | null;
    sceneName?: string;
    knobLabels?: readonly KnobLabel[];
    knobs: Readonly<Record<string, number>>;
    remainingSeconds: number | null;
    rms: number;
    bells?: readonly BellNote[];
    error?: string;
}

export interface Player {
    getSnapshot(): PlayerSnapshot;
    subscribe(listener: () => void): () => void;
    loadScene(scene: Scene): Promise<void>;
    setPlaying(isPlaying: boolean): Promise<void>;
    setKnob(sceneId: string, knobId: string, value: number): Promise<void>;
    resetKnobs(sceneId: string): Promise<void>;
    setTimer(seconds: number | null): Promise<void>;
    extendTimer(seconds: number): Promise<void>;
    setVolume(volume: number): Promise<void>;
}
