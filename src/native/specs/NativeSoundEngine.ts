import { TurboModuleRegistry } from 'react-native';
import type { TurboModule } from 'react-native';

export interface Spec extends TurboModule {
    readSnapshot(): string;
    loadScene(json: string): number;
    setPlaying(isPlaying: boolean): number;
    setKnob(sceneId: string, id: string, value: number): number;
    setTimer(seconds: number): number;
    setVolume(volume: number): void;
}

export default TurboModuleRegistry.get<Spec>('NativeSoundEngine');
