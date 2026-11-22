import { createEngine, readEngineError } from './engine';
import { createSignalCharts, drawParameterCurve, mapParameter } from './charts';
import { PROCESSOR_NAME } from './audio-protocol';
import type { AudioCommand, AudioReply, AudioRequest } from './audio-protocol';
import workletUrl from './worklet.ts?worker&url';
import focus from '../scenes/focus.json?raw';
import relax from '../scenes/relax.json?raw';
import sleep from '../scenes/sleep.json?raw';

type Scene = {
    id: string;
    name: string;
    seed?: number;
    layers: { id: string; type: 'pad' | 'noise' | 'bells'; params?: Record<string, number> }[];
    knobs?: { id: string; name: string; default?: number; targets: { param: string; from: number; to: number; curve?: 'linear' | 'exponential' }[] }[];
};

type ActiveScene = {
    scene: Scene;
    text: string;
    bytes: Uint8Array<ArrayBuffer>;
    positions: Map<string, number>;
};

type PendingReply = {
    resolve: () => void;
    reject: (error: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
};

const layerSettings = {
    pad: { name: 'Пэд', description: 'Протяжные аккорды и гармонический фон.', level: 0.12 },
    noise: { name: 'Шум', description: 'Непрерывная шуршащая текстура.', level: 0.05 },
    bells: { name: 'Колокольчики', description: 'Отдельные звенящие ноты.', level: 0.07 },
};
const knobDescriptions: Record<string, string> = {
    brightness: 'Больше высоких частот в пэде и шуме.',
    density: 'Колокольчики звучат чаще.',
    space: 'Больше отражений, и звуковой хвост дольше затихает.',
};

const parameterLabels: Record<string, [string, string]> = {
    'pad.cutoff': ['Срез пэда', 'Гц'],
    'noise.cutoff': ['Срез шума', 'Гц'],
    'bells.gapMin': ['Мин. интервал', 'с'],
    'bells.gapMax': ['Макс. интервал', 'с'],
    'scene.reverbLevel': ['Реверберация', ''],
    'scene.reverbDecay': ['Затухание', 'с'],
};
const formatParameter = new Intl.NumberFormat('ru', { maximumSignificantDigits: 4 });
const referenceKnobs = (JSON.parse(focus) as Scene).knobs;
const presets = new Map(Object.entries({ focus, relax, sleep }));

export function getElement<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Элемент «${id}» не найден.`);
    return element as T;
}
const source = getElement<HTMLTextAreaElement>('source');
const preset = getElement<HTMLSelectElement>('preset');
const file = getElement<HTMLInputElement>('file');
const apply = getElement<HTMLButtonElement>('apply');
const save = getElement<HTMLButtonElement>('save');
const play = getElement<HTMLButtonElement>('play');
const volume = getElement<HTMLInputElement>('volume');
const status = getElement('status');
const config = getElement<HTMLDialogElement>('config');
const showConfig = getElement<HTMLButtonElement>('show-config');
const configNotice = getElement('config-notice');
const audioStatus = getElement('audio-status');
const knobs = getElement('knobs');
const mixer = getElement('mixer');
const mixerHint = getElement('mixer-hint');
const activeScene = getElement('active-scene');
const playLabel = getElement('play-label');
const volumeValue = getElement<HTMLOutputElement>('volume-value');
const charts = createSignalCharts(
    getElement<HTMLCanvasElement>('scope').getContext('2d')!,
    getElement<HTMLCanvasElement>('spectrum').getContext('2d')!,
    getElement<HTMLCanvasElement>('spectrogram').getContext('2d')!,
);
const meter = getElement<HTMLMeterElement>('level');
const decibels = getElement<HTMLOutputElement>('decibels');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const validationFrame = [new Float32Array(1), new Float32Array(1)] as const;

let wasm: WebAssembly.Module | undefined;
let validator: ReturnType<typeof createEngine> | undefined;
let active: ActiveScene | undefined;
let audio: Awaited<ReturnType<typeof openAudio>> | undefined;
let playing = false;
let busy = false;

function report(element: HTMLElement, message: string, error = false) {
    element.textContent = message;
    element.dataset.error = String(error);
    if (element === status) {
        configNotice.textContent = error ? message : '';
        configNotice.hidden = !error;
        configNotice.dataset.error = String(error);
    }
}

function errorText(error: unknown) {
    if (error instanceof Uint8Array) return decoder.decode(error);
    const detail = readEngineError(error);
    return typeof detail === 'string' ? detail : decoder.decode(detail);
}

function updateButtons() {
    const hasDraft = !active || active.text !== source.value;
    const hasUnappliedChanges = Boolean(active && hasDraft);
    showConfig.dataset.draft = String(hasUnappliedChanges);
    showConfig.setAttribute('aria-label', hasUnappliedChanges ? 'Конфигурация JSON, есть правки' : 'Конфигурация JSON');
    apply.disabled = busy || !validator || !hasDraft;
    play.disabled = busy || !active;
    save.disabled = busy || !active || active.text !== source.value;
    preset.disabled = busy;
    getElement<HTMLButtonElement>('open').disabled = busy;
    source.disabled = busy || !validator;
    knobs.inert = busy;
    for (const slider of mixer.querySelectorAll('input')) {
        slider.disabled = busy || hasDraft || hasUnsafeSeed(active?.scene);
    }
    mixerHint.textContent = active && hasDraft
        ? 'Примените изменения в JSON, чтобы продолжить настройку уровней.'
        : hasUnsafeSeed(active?.scene)
            ? 'У этой сцены длинный сид. Уровни можно изменить в JSON без потери точности.'
            : 'Уровни слоёв записываются в JSON сцены.';
}

async function run(operation: () => Promise<void>, target = status) {
    if (busy) return;
    busy = true;
    updateButtons();
    report(target, '');
    try {
        await operation();
    } catch (error) {
        report(target, errorText(error), true);
    } finally {
        busy = false;
        updateButtons();
    }
}

function hasUnsafeSeed(scene: Scene | undefined) {
    return scene?.seed !== undefined && !Number.isSafeInteger(scene.seed);
}

function updateKnobs(current: ActiveScene) {
    knobs.replaceChildren();
    if (!current.scene.knobs?.length) {
        const message = document.createElement('p');
        message.textContent = 'В этой сцене нет ручек.';
        knobs.append(message);
        return;
    }
    for (const knob of current.scene.knobs) {
        const section = document.createElement('div');
        section.className = 'knob';
        const heading = document.createElement('div');
        heading.className = 'reading';
        const label = document.createElement('label');
        const slider = document.createElement('input');
        slider.id = `knob-${knobs.childElementCount}`;
        slider.type = 'range';
        slider.min = '0';
        slider.max = '1';
        slider.step = '0.001';
        slider.value = String(current.positions.get(knob.id) ?? knob.default ?? 0.5);
        label.htmlFor = slider.id;
        label.textContent = knob.name;
        const reading = document.createElement('output');
        reading.htmlFor.add(slider.id);
        const targets = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Затронутые параметры';
        const parameters = document.createElement('code');
        parameters.textContent = knob.targets.map(({ param }) => param).join(' · ');
        targets.append(summary, parameters);
        const description = document.createElement('p');
        const knownDescription = hasKnownKnobTargets(knob)
            ? knobDescriptions[knob.id]
            : undefined;
        description.textContent = knownDescription ?? 'Меняет параметры, связанные с этой ручкой в JSON.';
        const values = document.createElement('dl');
        values.className = 'parameter-values';
        const parameterValues = knob.targets.map((target) => {
            const [name, unit] = parameterLabels[target.param] ?? [target.param, ''];
            const entry = document.createElement('div');
            const term = document.createElement('dt');
            term.textContent = name;
            const result = document.createElement('dd');
            const curve = document.createElement('canvas');
            curve.width = 360;
            curve.height = 40;
            curve.setAttribute('aria-hidden', 'true');
            const plot = curve.getContext('2d')!;
            entry.append(term, result, curve);
            values.append(entry);
            return { target, result, unit, plot };
        });
        const update = (send: boolean) => {
            const value = slider.valueAsNumber;
            reading.textContent = `${Math.round(value * 100)} %`;
            for (const { target, result, unit, plot } of parameterValues) {
                const mapped = mapParameter(target, value);
                result.textContent = [formatParameter.format(mapped), unit].filter(Boolean).join(' ');
                drawParameterCurve(plot, target, value);
            }
            if (!send) return;
            current.positions.set(knob.id, value);
            audio?.send('knob', encoder.encode(knob.id), value).then(markAudibleChange).catch((error) => {
                report(audioStatus, errorText(error), true);
            });
        };
        slider.addEventListener('input', () => update(true));
        update(false);
        heading.append(label, reading);
        section.append(heading, description, slider, values, targets);
        knobs.append(section);
    }
}

function hasKnownKnobTargets(knob: NonNullable<Scene['knobs']>[number]) {
    const reference = referenceKnobs?.find(({ id }) => id === knob.id);
    return reference?.targets.length === knob.targets.length
        && reference.targets.every(({ param, from, to }) => knob.targets.some((target) =>
            target.param === param && Math.sign(target.to - target.from) === Math.sign(to - from)));
}

function updateMixer(current: ActiveScene) {
    mixer.replaceChildren();
    const controlled = new Set(current.scene.knobs?.flatMap(({ targets }) => targets.map(({ param }) => param)));
    for (const [index, layer] of current.scene.layers.entries()) {
        const settings = layerSettings[layer.type];
        const section = document.createElement('div');
        section.className = 'knob';
        const heading = document.createElement('div');
        heading.className = 'reading';
        const label = document.createElement('label');
        label.textContent = layer.id === layer.type ? settings.name : `${settings.name} · ${layer.id}`;
        const description = document.createElement('p');
        if (controlled.has(`${layer.id}.level`)) {
            description.textContent = 'Уровнем этого слоя управляет ручка сцены.';
            section.append(label, description);
            mixer.append(section);
            continue;
        }

        description.textContent = settings.description;
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = `layer-level-${index}`;
        slider.min = '0';
        slider.max = '1';
        slider.step = '0.001';
        slider.value = String(layer.params?.level ?? settings.level);
        label.htmlFor = slider.id;
        const reading = document.createElement('output');
        reading.htmlFor.add(slider.id);
        reading.value = `${Number((slider.valueAsNumber * 100).toFixed(1))} %`;
        slider.addEventListener('input', () => {
            reading.value = `${Number((slider.valueAsNumber * 100).toFixed(1))} %`;
        });
        slider.addEventListener('change', async () => {
            const shouldRestoreFocus = document.activeElement === slider;
            await run(async () => {
                const draft = JSON.parse(current.text) as Scene;
                const editedLayer = draft.layers[index];
                editedLayer.params ??= {};
                editedLayer.params.level = slider.valueAsNumber;
                source.value = `${JSON.stringify(draft, null, 4)}\n`;
                await applyScene(current.positions);
            });
            if (shouldRestoreFocus) document.getElementById(slider.id)?.focus({ preventScroll: true });
        });
        heading.append(label, reading);
        section.append(heading, description, slider);
        mixer.append(section);
    }
}

function updatePlaybackLabel() {
    playLabel.textContent = playing ? 'Пауза' : 'Слушать';
    play.dataset.playing = String(playing);
}

async function applyScene(positions = new Map<string, number>()) {
    if (!validator) throw new Error('Звуковое ядро ещё не загружено.');
    const text = source.value;
    const bytes = encoder.encode(text);
    validator.load(bytes);
    validator.render(...validationFrame);
    const scene = JSON.parse(text) as Scene;
    if (audio) {
        await audio.send('load', bytes);
        markAudibleChange();
        for (const [id, value] of positions) {
            await audio.send('knob', encoder.encode(id), value);
        }
    }
    active = { scene, text, bytes, positions };
    activeScene.textContent = scene.name;
    if (preset.value === '') {
        const customOption = preset.querySelector('option[value=""]');
        if (customOption) {
            customOption.textContent = scene.name;
        }
    }
    updateKnobs(active);
    updateMixer(active);
    report(status, 'Конфигурация применена.');
}

function showDraft() {
    if (!active || active.text !== source.value) {
        report(status, 'Есть изменения. Примените их для прослушивания и экспорта.');
    } else {
        report(status, `Сцена «${active.scene.name}» применена.`);
    }
    updateButtons();
}

async function loadPreset() {
    const text = presets.get(preset.value);
    if (!text) return;
    source.value = text;
    await applyScene();
}

function markAudibleChange() {
    if (playing) charts.markChange();
}

function updatePeak(peak: number) {
    meter.value = peak;
    decibels.value = peak ? `${(20 * Math.log10(peak)).toFixed(1)} дБFS` : '−∞ дБFS';
}

async function openAudio() {
    if (!wasm || !active) throw new Error('Сначала загрузите сцену.');
    const { bytes, positions } = active;
    const context = new AudioContext();
    try {
        await context.resume();
        await context.audioWorklet.addModule(workletUrl);
        const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
            numberOfInputs: 0,
            outputChannelCount: [2],
            processorOptions: { module: wasm },
        });
        const splitter = context.createChannelSplitter(2);
        const analysers = [context.createAnalyser(), context.createAnalyser()];
        node.connect(context.destination);
        node.connect(splitter);
        analysers.forEach((analyser, channel) => splitter.connect(analyser, channel));
        const spectrumAnalyser = context.createAnalyser();
        spectrumAnalyser.fftSize = 4096;
        spectrumAnalyser.maxDecibels = -20;
        node.connect(spectrumAnalyser);
        const frequencies = new Uint8Array(spectrumAnalyser.frequencyBinCount);
        const signals = analysers.map((analyser) => new Float32Array(analyser.fftSize));

        let sequence = 0;
        let failed: Error | undefined;
        const pending = new Map<number, PendingReply>();
        node.port.onmessage = ({ data: { id, error } }: MessageEvent<AudioReply>) => {
            const reply = pending.get(id);
            if (!reply) return;
            pending.delete(id);
            clearTimeout(reply.timeout);
            if (error) reply.reject(error);
            else reply.resolve();
        };
        const failAudio = (message: string) => {
            if (failed) return;
            failed = new Error(message);
            for (const { reject, timeout } of pending.values()) {
                clearTimeout(timeout);
                reject(failed);
            }
            pending.clear();
            if (audio?.context === context) {
                audio = undefined;
                playing = false;
                updatePlaybackLabel();
                report(audioStatus, failed.message, true);
                charts.reset();
                updatePeak(0);
                void context.close().catch(() => {});
            }
        };
        node.onprocessorerror = () => failAudio('Аудиодвижок остановился. Запустите прослушивание снова.');
        const send = (...command: AudioCommand) => {
            return new Promise<void>((resolve, reject) => {
                if (failed) {
                    reject(failed);
                    return;
                }
                const id = sequence++;
                const timeout = setTimeout(() => {
                    failAudio('Аудиодвижок не ответил. Запустите прослушивание снова.');
                }, 3000);
                pending.set(id, { resolve, reject, timeout });
                const request: AudioRequest = { id, command };
                try {
                    node.port.postMessage(request);
                } catch {
                    failAudio('Не удалось отправить команду. Запустите прослушивание снова.');
                }
            });
        };

        await send('load', bytes);
        await send('volume', volume.valueAsNumber);
        for (const [id, value] of positions) {
            await send('knob', encoder.encode(id), value);
        }

        function updateMeter(now: number) {
            if (failed || context.state === 'closed') return;
            let peak = 0;
            analysers.forEach((analyser, index) => {
                const signal = signals[index];
                analyser.getFloatTimeDomainData(signal);
                for (const sample of signal) peak = Math.max(peak, Math.abs(sample));
            });
            spectrumAnalyser.getByteFrequencyData(frequencies);
            charts.update(signals[0], frequencies, context.sampleRate / spectrumAnalyser.fftSize, now);
            updatePeak(peak);
            requestAnimationFrame(updateMeter);
        }
        requestAnimationFrame(updateMeter);
        return { context, send };
    } catch (error) {
        await context.close();
        throw error;
    }
}

showConfig.addEventListener('click', () => config.showModal());
const brandCarousel = getElement<HTMLButtonElement>('brand-carousel');
const brandTrack = brandCarousel.querySelector<HTMLElement>('.brand-track')!;
const brandPattern = brandTrack.querySelector<HTMLElement>('.brand-pattern')!;
const brandItem = brandPattern.querySelector<HTMLElement>('.brand-item')!;
const brandLogoUrls = [
    ...Array.from(brandItem.querySelectorAll('img'), (icon) => icon.src),
    ...['crest', 'step', 'ripple', 'pair', 'fall', 'hush', 'signal', 'drift', 'spark', 'breath'].map((name) =>
        `${import.meta.env.BASE_URL}brand/${name}.png`),
];
const brandLogosPerWord = brandItem.querySelectorAll('img').length;
const brandCopy = brandPattern.cloneNode() as HTMLElement;
brandPattern.after(brandCopy);
let brandRepeatCount = 0;
const brandResizeObserver = new ResizeObserver(() => {
    if (!brandCarousel.clientHeight) return;
    const gap = Number.parseFloat(getComputedStyle(brandPattern).rowGap);
    const itemHeight = brandItem.getBoundingClientRect().height + gap;
    const repeatCount = Math.max(
        Math.ceil(brandCarousel.clientHeight / itemHeight),
        Math.ceil(brandLogoUrls.length / brandLogosPerWord),
    );
    if (repeatCount === brandRepeatCount) return;

    brandRepeatCount = repeatCount;
    brandPattern.replaceChildren(brandItem);
    for (let index = 1; index < repeatCount; index++) {
        const word = brandItem.cloneNode(true) as HTMLElement;
        word.querySelectorAll('img').forEach((icon, logoIndex) => {
            icon.src = brandLogoUrls[(index * brandLogosPerWord + logoIndex) % brandLogoUrls.length];
        });
        brandPattern.append(word);
    }
    brandCopy.replaceChildren(...Array.from(brandPattern.children, (item) => item.cloneNode(true)));
    const pixelsPerSecond = 32;
    brandTrack.style.setProperty('--brand-duration', `${itemHeight * repeatCount / pixelsPerSecond}s`);
});
brandResizeObserver.observe(brandCarousel);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
brandCarousel.disabled = reducedMotion.matches;
reducedMotion.addEventListener('change', ({ matches }) => {
    brandCarousel.disabled = matches;
});
brandCarousel.addEventListener('click', () => {
    const isPaused = brandCarousel.getAttribute('aria-pressed') === 'true';
    brandCarousel.setAttribute('aria-pressed', String(!isPaused));
});

const scrollbarTimers = new WeakMap<Element, number>();
document.addEventListener('scroll', ({ target }) => {
    const scrollContainer = target === document ? document.documentElement : target;
    if (!(scrollContainer instanceof Element)) return;

    scrollContainer.classList.add('is-scrolling');
    window.clearTimeout(scrollbarTimers.get(scrollContainer));
    scrollbarTimers.set(scrollContainer, window.setTimeout(() => {
        scrollContainer.classList.remove('is-scrolling');
        scrollbarTimers.delete(scrollContainer);
    }, 600));
}, { capture: true, passive: true });

source.addEventListener('input', showDraft);
apply.addEventListener('click', () => run(applyScene));
preset.addEventListener('change', () => run(loadPreset));
getElement<HTMLButtonElement>('open').addEventListener('click', () => file.click());
file.addEventListener('change', () => {
    const selected = file.files?.[0];
    file.value = '';
    if (!selected) return;
    void run(async () => {
        source.value = await selected.text();
        preset.value = '';
        await applyScene();
    });
});
save.addEventListener('click', () => {
    if (!active) return;
    const url = URL.createObjectURL(new Blob([active.text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${active.scene.id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'scene'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
play.addEventListener('click', () => run(async () => {
    audio ??= await openAudio();
    await audio.context.resume();
    await audio.send('playback', !playing);
    playing = !playing;
    updatePlaybackLabel();
}, audioStatus));
volume.addEventListener('input', () => {
    volumeValue.value = `${Math.round(volume.valueAsNumber * 100)} %`;
    audio?.send('volume', volume.valueAsNumber).then(markAudibleChange).catch((error) => {
        report(audioStatus, errorText(error), true);
    });
});

charts.reset();
void run(async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}sound_web.wasm`);
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
        throw new Error('Файл звукового ядра отсутствует. Для локального запуска используйте npm run dev в studio.');
    }
    wasm = await WebAssembly.compile(await response.arrayBuffer());
    validator = createEngine(wasm, 48000);
    await loadPreset();
});
