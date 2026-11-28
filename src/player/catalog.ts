import focus from '../../scenes/focus.json';
import relax from '../../scenes/relax.json';
import sleep from '../../scenes/sleep.json';
import solfeggio from '../../scenes/solfeggio.json';

export interface KnobChoices {
    param: string;
    values: readonly number[];
    unit: string;
}

export interface KnobLabel {
    id: string;
    name: string;
    choices?: KnobChoices;
}

export interface Scene {
    id: string;
    name: string;
    json: string;
    knobs?: readonly (KnobLabel & { default?: number })[];
}

export const scenes: readonly Scene[] = [focus, relax, sleep, solfeggio].map(scene => ({
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
            const choices = 'choices' in knob ? readKnobChoices(knob.choices) : undefined;
            return [{ id: knob.id, name: knob.name, default: typeof value === 'number' ? value : undefined, choices }];
        })
        : undefined;
    return { id: data.id, name: data.name, knobs, json };
}

export function getInitialKnobs(scene: Scene): Record<string, number> {
    return Object.fromEntries((scene.knobs ?? []).map(knob => [knob.id, snapKnobPosition(knob.default ?? 0.5, knob.choices)]));
}

export function readKnobChoices(data: unknown): KnobChoices | undefined {
    if (!data || typeof data !== 'object' ||
        !('param' in data) || typeof data.param !== 'string' ||
        !('unit' in data) || typeof data.unit !== 'string' ||
        !('values' in data) || !Array.isArray(data.values) || data.values.length < 2 ||
        !data.values.every(value => typeof value === 'number' && Number.isFinite(value))) {
        return undefined;
    }
    return { param: data.param, unit: data.unit, values: data.values };
}

export function getKnobChoice(choices: KnobChoices, position: number): number | undefined {
    return choices.values[Math.round(position * (choices.values.length - 1))];
}

export function snapKnobPosition(position: number, choices?: KnobChoices): number {
    if (!choices) {
        return position;
    }
    const lastIndex = choices.values.length - 1;
    return Math.round(position * lastIndex) / lastIndex;
}
