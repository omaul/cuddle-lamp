type EngineExports = WebAssembly.Exports & {
    memory: WebAssembly.Memory;
    init: (rate: number) => void;
    input_ptr: (length: number) => number;
    error_ptr: () => number;
    error_len: () => number;
    block_size: () => number;
    audio_ptr: () => number;
    load: () => number;
    knob: (value: number) => number;
    playback: (isPlaying: number) => number;
    volume: (value: number) => void;
    render: (frames: number) => void;
};

class EngineError extends Error {
    constructor(readonly bytes: Uint8Array<ArrayBuffer>) {
        super('Ошибка звукового ядра');
    }
}

export function readEngineError(error: unknown): string | Uint8Array<ArrayBuffer> {
    if (error instanceof EngineError) return error.bytes;
    return error instanceof Error ? error.message : String(error);
}

export function createEngine(module: WebAssembly.Module, rate: number) {
    const wasm = new WebAssembly.Instance(module).exports as EngineExports;
    wasm.init(rate);

    const write = (bytes: Uint8Array) => {
        const pointer = wasm.input_ptr(bytes.length);
        new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
    };

    const check = (result: number) => {
        if (!result) {
            const error = new Uint8Array(wasm.memory.buffer, wasm.error_ptr(), wasm.error_len());
            throw new EngineError(error.slice());
        }
    };

    const size = wasm.block_size();
    const pointer = wasm.audio_ptr();
    let audio = new Float32Array(wasm.memory.buffer, pointer, size * 2);

    return {
        load(text: Uint8Array) {
            write(text);
            check(wasm.load());
        },
        knob(id: Uint8Array, value: number) {
            write(id);
            check(wasm.knob(value));
        },
        playback(isPlaying: boolean) {
            check(wasm.playback(Number(isPlaying)));
        },
        volume: wasm.volume,
        render(left: Float32Array, right: Float32Array) {
            for (let offset = 0; offset < left.length; offset += size) {
                const frames = Math.min(left.length - offset, size);
                wasm.render(frames);
                if (audio.buffer !== wasm.memory.buffer) {
                    audio = new Float32Array(wasm.memory.buffer, pointer, size * 2);
                }
                for (let frame = 0; frame < frames; frame++) {
                    left[offset + frame] = audio[frame];
                    right[offset + frame] = audio[size + frame];
                }
            }
        },
    };
}
