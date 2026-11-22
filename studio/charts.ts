type ParameterRange = {
    from: number;
    to: number;
    curve?: 'linear' | 'exponential';
};

const historyInterval = 100;
const minimumFrequency = 40;
const frequencyRatio = 250;
const actionColor = '#ffbb86';
const signalColor = '#a4d3a1';
const heatColors = ['#191b1d', '#21312b', '#2b473a', '#37614d', '#478064', '#63a17e', '#87c398', '#c5e6ae'];

export function mapParameter(range: ParameterRange, position: number) {
    if (range.curve === 'exponential') {
        return range.from * Math.pow(range.to / range.from, position);
    }
    return range.from + (range.to - range.from) * position;
}

export function drawParameterCurve(plot: CanvasRenderingContext2D, range: ParameterRange, position: number) {
    const { width, height } = plot.canvas;
    const minimum = Math.min(range.from, range.to);
    const span = Math.abs(range.to - range.from);
    const inset = 5;
    const getX = (value: number) => {
        return inset + value * (width - inset * 2);
    };
    const getY = (value: number) => {
        const fraction = span ? (mapParameter(range, value) - minimum) / span : 0.5;
        return height - inset - fraction * (height - inset * 2);
    };

    plot.clearRect(0, 0, width, height);
    plot.lineWidth = 1;
    plot.strokeStyle = '#50565a';
    plot.beginPath();
    plot.moveTo(inset, height - inset);
    plot.lineTo(width - inset, height - inset);
    plot.moveTo(getX(position), height - inset);
    plot.lineTo(getX(position), getY(position));
    plot.stroke();

    plot.lineWidth = 2;
    plot.strokeStyle = '#81ae91';
    plot.beginPath();
    plot.moveTo(getX(0), getY(0));
    for (let step = 1; step <= 32; step++) plot.lineTo(getX(step / 32), getY(step / 32));
    plot.stroke();
    plot.fillStyle = actionColor;
    plot.beginPath();
    plot.arc(getX(position), getY(position), 4, 0, Math.PI * 2);
    plot.fill();
}

export function createSignalCharts(
    waveform: CanvasRenderingContext2D,
    spectrum: CanvasRenderingContext2D,
    history: CanvasRenderingContext2D,
) {
    const bands = new Uint8Array(history.canvas.height);
    let lastHistoryUpdate: number | undefined;
    let hasPendingMarker = false;

    const drawGrid = (plot: CanvasRenderingContext2D) => {
        const { width, height } = plot.canvas;
        plot.clearRect(0, 0, width, height);
        plot.strokeStyle = '#363a3f';
        plot.lineWidth = 1;
        plot.beginPath();
        for (let column = 1; column < 12; column++) {
            const x = width * column / 12;
            plot.moveTo(x, 0);
            plot.lineTo(x, height);
        }
        for (const y of [height / 4, height / 2, height * 3 / 4]) {
            plot.moveTo(0, y);
            plot.lineTo(width, y);
        }
        plot.stroke();
    };

    const drawWaveform = (signal: Float32Array | null) => {
        drawGrid(waveform);
        const { width, height } = waveform.canvas;
        waveform.strokeStyle = signalColor;
        waveform.lineWidth = 2;
        waveform.beginPath();
        for (let x = 0; x < width; x++) {
            const value = signal?.[Math.floor(x * signal.length / width)] ?? 0;
            const y = (1 - value) * height / 2;
            if (x === 0) waveform.moveTo(x, y);
            else waveform.lineTo(x, y);
        }
        waveform.stroke();
    };

    const drawSpectrum = () => {
        drawGrid(spectrum);
        const { width, height } = spectrum.canvas;
        const barWidth = width / bands.length;
        spectrum.fillStyle = signalColor;
        for (const [index, intensity] of bands.entries()) {
            const barHeight = intensity / 255 * height;
            spectrum.fillRect(index * barWidth, height - barHeight, barWidth - 3, barHeight);
        }
    };

    const drawHistory = (now: number) => {
        const { width, height } = history.canvas;
        const previous = lastHistoryUpdate ?? now - historyInterval;
        const elapsedSteps = Math.floor((now - previous) / historyInterval);
        if (elapsedSteps < 1) return;
        lastHistoryUpdate = previous + elapsedSteps * historyInterval;

        const shift = Math.min(elapsedSteps, width);
        if (shift < width) history.drawImage(history.canvas, -shift, 0);
        history.clearRect(width - shift, 0, shift, height);
        for (const [index, intensity] of bands.entries()) {
            const color = Math.round(intensity / 255 * (heatColors.length - 1));
            history.fillStyle = heatColors[color];
            history.fillRect(width - 1, height - 1 - index, 1, 1);
        }
        if (hasPendingMarker) {
            history.fillStyle = actionColor;
            history.fillRect(width - 1, 0, 1, 3);
            hasPendingMarker = false;
        }
    };

    return {
        markChange() {
            hasPendingMarker = true;
        },
        reset() {
            bands.fill(0);
            hasPendingMarker = false;
            lastHistoryUpdate = undefined;
            history.clearRect(0, 0, history.canvas.width, history.canvas.height);
            drawWaveform(null);
            drawSpectrum();
        },
        update(signal: Float32Array, frequencies: Uint8Array, binWidth: number, now: number) {
            for (let index = 0; index < bands.length; index++) {
                const frequency = minimumFrequency * Math.pow(frequencyRatio, index / bands.length);
                const nextFrequency = minimumFrequency * Math.pow(frequencyRatio, (index + 1) / bands.length);
                const first = Math.round(frequency / binWidth);
                const last = Math.min(frequencies.length - 1, Math.round(nextFrequency / binWidth));
                let intensity = 0;
                for (let bin = first; bin <= last; bin++) intensity = Math.max(intensity, frequencies[bin]);
                bands[index] = intensity;
            }
            drawWaveform(signal);
            drawSpectrum();
            drawHistory(now);
        },
    };
}
