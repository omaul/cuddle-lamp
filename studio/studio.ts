import { createEngine, readEngineError } from './engine';
import { PROCESSOR_NAME } from './audio-protocol';
import type { AudioCommand, AudioReply, AudioRequest } from './audio-protocol';
import workletUrl from './worklet.ts?worker&url';
import focus from '../scenes/focus.json?raw';
import relax from '../scenes/relax.json?raw';
import sleep from '../scenes/sleep.json?raw';

type Scene = {
    id: string;
    name: string;
    knobs?: { id: string; name: string; default?: number; targets: { param: string }[] }[];
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
};

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
const audioStatus = getElement('audio-status');
const knobs = getElement('knobs');
const canvas = getElement<HTMLCanvasElement>('scope');
const plot = canvas.getContext('2d')!;
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
}

function errorText(error: unknown) {
    if (error instanceof Uint8Array) return decoder.decode(error);
    const detail = readEngineError(error);
    return typeof detail === 'string' ? detail : decoder.decode(detail);
}

function updateButtons() {
    apply.disabled = busy || !validator;
    play.disabled = busy || !active;
    save.disabled = busy || !active || active.text !== source.value;
    preset.disabled = busy;
    getElement<HTMLButtonElement>('open').disabled = busy;
    source.disabled = busy || !validator;
    knobs.inert = busy;
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
        slider.value = String(knob.default ?? 0.5);
        label.htmlFor = slider.id;
        label.textContent = knob.name;
        const reading = document.createElement('output');
        reading.htmlFor.add(slider.id);
        const targets = document.createElement('p');
        targets.textContent = knob.targets.map(({ param }) => param).join(' · ');
        const update = (send: boolean) => {
            const value = slider.valueAsNumber;
            reading.textContent = `${Math.round(value * 100)} %`;
            if (!send) return;
            current.positions.set(knob.id, value);
            audio?.send('knob', encoder.encode(knob.id), value).catch((error) => {
                report(audioStatus, errorText(error), true);
            });
        };
        slider.addEventListener('input', () => update(true));
        update(false);
        heading.append(label, reading);
        section.append(heading, slider, targets);
        knobs.append(section);
    }
}

async function applyScene() {
    if (!validator) throw new Error('Звуковое ядро ещё не загружено.');
    const text = source.value;
    const bytes = encoder.encode(text);
    validator.load(bytes);
    validator.render(...validationFrame);
    const scene = JSON.parse(text) as Scene;
    if (audio) await audio.send('load', bytes);
    active = { scene, text, bytes, positions: new Map() };
    updateKnobs(active);
    report(status, `Сцена «${scene.name}» прошла проверку и применена.`);
}

function showDraft() {
    if (!active || active.text !== source.value) {
        report(status, 'Есть изменения. Проверьте и примените сцену перед экспортом.');
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

function draw(signal: Float32Array | null, peak: number) {
    const { width, height } = canvas;
    plot.clearRect(0, 0, width, height);
    plot.strokeStyle = '#373b42';
    for (const y of [height / 4, height / 2, height * 3 / 4]) {
        plot.beginPath();
        plot.moveTo(0, y);
        plot.lineTo(width, y);
        plot.stroke();
    }
    if (signal) {
        plot.strokeStyle = '#ffbb86';
        plot.lineWidth = 2;
        plot.beginPath();
        for (let x = 0; x < width; x++) {
            const value = signal[Math.floor(x * signal.length / width)];
            const y = (1 - value) * height / 2;
            if (x === 0) plot.moveTo(x, y);
            else plot.lineTo(x, y);
        }
        plot.stroke();
    }
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
        const signals = analysers.map((analyser) => new Float32Array(analyser.fftSize));

        let sequence = 0;
        let failed: Error | undefined;
        const pending = new Map<number, PendingReply>();
        node.port.onmessage = ({ data: { id, error } }: MessageEvent<AudioReply>) => {
            const reply = pending.get(id);
            if (!reply) return;
            pending.delete(id);
            if (error) reply.reject(error);
            else reply.resolve();
        };
        node.onprocessorerror = () => {
            failed = new Error('Аудиодвижок остановился. Запустите прослушивание снова.');
            for (const { reject } of pending.values()) reject(failed);
            pending.clear();
            if (audio?.context === context) {
                audio = undefined;
                playing = false;
                play.textContent = 'Слушать';
                report(audioStatus, failed.message, true);
                draw(null, 0);
                void context.close();
            }
        };
        const send = (...command: AudioCommand) => {
            return new Promise<void>((resolve, reject) => {
                if (failed) {
                    reject(failed);
                    return;
                }
                const id = sequence++;
                pending.set(id, { resolve, reject });
                const request: AudioRequest = { id, command };
                node.port.postMessage(request);
            });
        };

        await send('load', bytes);
        await send('volume', volume.valueAsNumber);
        for (const [id, value] of positions) {
            await send('knob', encoder.encode(id), value);
        }

        function updateMeter() {
            if (failed || context.state === 'closed') return;
            let peak = 0;
            analysers.forEach((analyser, index) => {
                const signal = signals[index];
                analyser.getFloatTimeDomainData(signal);
                for (const sample of signal) peak = Math.max(peak, Math.abs(sample));
            });
            draw(signals[0], peak);
            requestAnimationFrame(updateMeter);
        }
        requestAnimationFrame(updateMeter);
        return { context, send };
    } catch (error) {
        await context.close();
        throw error;
    }
}

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
    play.textContent = playing ? 'Пауза' : 'Слушать';
}, audioStatus));
volume.addEventListener('input', () => {
    audio?.send('volume', volume.valueAsNumber).catch((error) => {
        report(audioStatus, errorText(error), true);
    });
});

draw(null, 0);
void run(async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}sound_web.wasm`);
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
        throw new Error('Файл звукового ядра отсутствует. Для локального запуска используйте npm run dev в studio.');
    }
    wasm = await WebAssembly.compile(await response.arrayBuffer());
    validator = createEngine(wasm, 48000);
    await loadPreset();
});
