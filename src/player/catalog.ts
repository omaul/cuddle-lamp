import focus from '../../scenes/focus.json';
import relax from '../../scenes/relax.json';
import sleep from '../../scenes/sleep.json';

export interface Scene {
    id: string;
    name: string;
    json: string;
    knobs?: readonly { id: string; name: string; default?: number }[];
}

export const scenes: readonly Scene[] = [focus, relax, sleep].map(scene => ({
    ...scene,
    json: JSON.stringify(scene),
}));

export function readSceneMetadata(json: string): Scene {
    const data: unknown = JSON.parse(json);
    if (!data || typeof data !== 'object' ||
        !('id' in data) || typeof data.id !== 'string' ||
        !('name' in data) || typeof data.name !== 'string') {
        throw new Error('В JSON сцены должны быть строковые поля id и name');
    }
    const knobs: Scene['knobs'] = 'knobs' in data && Array.isArray(data.knobs)
        ? data.knobs.flatMap((knob: unknown) => {
            if (!knob || typeof knob !== 'object' ||
                !('id' in knob) || typeof knob.id !== 'string' ||
                !('name' in knob) || typeof knob.name !== 'string') {
                return [];
            }
            const value = 'default' in knob ? knob.default : undefined;
            return [{ id: knob.id, name: knob.name, default: typeof value === 'number' ? value : undefined }];
        })
        : undefined;
    return { id: data.id, name: data.name, knobs, json };
}

export function getInitialKnobs(scene: Scene): Record<string, number> {
    return Object.fromEntries((scene.knobs ?? []).map(knob => [knob.id, knob.default ?? 0.5]));
}
