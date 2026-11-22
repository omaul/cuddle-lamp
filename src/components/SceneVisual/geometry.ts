const TAU = 2 * Math.PI;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const POINT_COUNT = 120;

export function getScenePoint(sceneId: string | null, index: number, progress: number) {
    const phase = TAU * progress;

    if (sceneId === 'relax') {
        const radius = Math.sqrt((index + 0.5) / POINT_COUNT);
        const angle = index * GOLDEN_ANGLE;
        const curl = angle + 0.36 * Math.sin(phase + radius * 5) + 0.24 * radius * Math.sin(phase * 2);
        const distance = radius * (0.39 + 0.045 * Math.cos(angle * 3 - phase));
        return {
            x: Math.cos(curl) * distance,
            y: Math.sin(curl) * distance,
        };
    }

    if (sceneId === 'sleep') {
        const band = Math.floor(index / 24) - 2;
        const position = (index % 24) / 23;
        const wave = position * TAU - phase;
        return {
            x: (position - 0.5) * (0.87 - Math.abs(band) * 0.045),
            y: band * 0.061 + Math.sin(wave + band * 0.19) * 0.091 + Math.sin(wave * 2 + phase) * 0.035,
        };
    }

    const strand = Math.floor(index / 40) - 1;
    const angle = ((index % 40) / 40) * TAU;
    const drift = Math.sin(phase) * 0.58;
    const radius = 0.35 + strand * 0.055;
    return {
        x: Math.sin(angle * 2 + drift + strand * 0.25) * radius,
        y: Math.cos(angle * 3 + phase + strand * 0.23) * radius * 0.83,
    };
}
