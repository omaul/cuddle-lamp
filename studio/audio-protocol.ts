export const PROCESSOR_NAME = 'sound-studio';

export type AudioCommand =
    | ['load', Uint8Array]
    | ['knob', Uint8Array, number]
    | ['playback', boolean]
    | ['volume', number];

export type AudioRequest = {
    id: number;
    command: AudioCommand;
};

export type AudioReply = {
    id: number;
    error?: string | Uint8Array<ArrayBuffer>;
};

export type AudioProcessorOptions = {
    processorOptions: { module: WebAssembly.Module };
};
