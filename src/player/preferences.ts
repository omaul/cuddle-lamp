import { scenes, type Scene } from './catalog';

interface PreferencesStorage {
    read(): unknown;
    write(value: string): void;
}

type KnobValues = Readonly<Record<string, number>>;

export function createPlayerPreferences(storage?: PreferencesStorage) {
    let lastSceneId: string | undefined;
    const knobValuesBySceneId = new Map<string, KnobValues>();
    const storedValue = storage?.read();
    if (typeof storedValue === 'string') {
        try {
            const saved = JSON.parse(storedValue);
            lastSceneId = scenes.find(scene => scene.id === saved?.lastSceneId)?.id;
            for (const scene of scenes) {
                const savedKnobs = saved?.knobValuesBySceneId?.[scene.id];
                const entries = (scene.knobs ?? []).flatMap(knob => {
                    const value = savedKnobs?.[knob.id];
                    return typeof value === 'number' && value >= 0 && value <= 1 ? [[knob.id, value] as const] : [];
                });
                if (entries.length > 0) {
                    knobValuesBySceneId.set(scene.id, Object.fromEntries(entries));
                }
            }
        } catch {
            // Если сохранённые настройки повреждены, плеер начнёт с авторских значений.
        }
    }

    const save = () => {
        storage?.write(JSON.stringify({
            lastSceneId,
            knobValuesBySceneId: Object.fromEntries(knobValuesBySceneId),
        }));
    };

    return {
        getLastScene() {
            return scenes.find(scene => scene.id === lastSceneId);
        },
        getKnobs(scene: Scene): KnobValues {
            return scenes.includes(scene) ? knobValuesBySceneId.get(scene.id) ?? {} : {};
        },
        rememberScene(scene: Scene) {
            if (scenes.includes(scene) && lastSceneId !== scene.id) {
                lastSceneId = scene.id;
                save();
            }
        },
        rememberKnob(scene: Scene, knobId: string, value: number) {
            if (scenes.includes(scene)) {
                knobValuesBySceneId.set(scene.id, { ...knobValuesBySceneId.get(scene.id), [knobId]: value });
                save();
            }
        },
        forgetKnobs(scene: Scene) {
            if (scenes.includes(scene) && knobValuesBySceneId.delete(scene.id)) {
                save();
            }
        },
    };
}
