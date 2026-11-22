declare const sampleRate: number;

declare abstract class AudioWorkletProcessor {
    readonly port: MessagePort;

    abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

declare function registerProcessor(
    name: string,
    processorConstructor: new (options: import('./audio-protocol').AudioProcessorOptions) => AudioWorkletProcessor,
): void;
