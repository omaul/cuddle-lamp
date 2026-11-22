import { createEngine, readEngineError } from './engine';
import { PROCESSOR_NAME } from './audio-protocol';
import type { AudioProcessorOptions, AudioReply, AudioRequest } from './audio-protocol';

class SoundStudio extends AudioWorkletProcessor {
    private readonly engine: ReturnType<typeof createEngine>;

    constructor({ processorOptions }: AudioProcessorOptions) {
        super();
        this.engine = createEngine(processorOptions.module, sampleRate);
        this.port.onmessage = this.handleCommand.bind(this);
    }

    private handleCommand({ data: { id, command } }: MessageEvent<AudioRequest>) {
        const reply: AudioReply = { id };
        try {
            switch (command[0]) {
                case 'load':
                    this.engine.load(command[1]);
                    break;
                case 'knob':
                    this.engine.knob(command[1], command[2]);
                    break;
                case 'playback':
                    this.engine.playback(command[1]);
                    break;
                case 'volume':
                    this.engine.volume(command[1]);
                    break;
            }
        } catch (error) {
            reply.error = readEngineError(error);
        }
        this.port.postMessage(reply);
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
        const [left, right] = outputs[0] ?? [];
        if (left && right) this.engine.render(left, right);
        return true;
    }
}

registerProcessor(PROCESSOR_NAME, SoundStudio);
