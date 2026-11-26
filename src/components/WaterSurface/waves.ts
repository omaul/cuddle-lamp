export const WAVE_COLUMNS = 21;
export const WAVE_ROWS = 19;

export function createWaveField() {
    'worklet';
    return {
        current: new Float32Array(WAVE_COLUMNS * WAVE_ROWS),
        prev: new Float32Array(WAVE_COLUMNS * WAVE_ROWS),
    };
}

export function disturbWaveField(field: ReturnType<typeof createWaveField>, x: number, y: number, strength: number) {
    'worklet';
    const centerColumn = Math.max(1, Math.min(WAVE_COLUMNS - 2, x * (WAVE_COLUMNS - 1)));
    const centerRow = Math.max(1, Math.min(WAVE_ROWS - 2, y * (WAVE_ROWS - 1)));
    const column = Math.round(centerColumn);
    const row = Math.round(centerRow);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const targetRow = row + offsetY;
            const targetColumn = column + offsetX;
            if (
                targetRow === 0 ||
                targetRow === WAVE_ROWS - 1 ||
                targetColumn === 0 ||
                targetColumn === WAVE_COLUMNS - 1
            ) {
                continue;
            }
            const cell = targetRow * WAVE_COLUMNS + targetColumn;
            const distance = Math.hypot(targetColumn - centerColumn, targetRow - centerRow);
            const impulse = strength * Math.max(0, 1 - distance / 1.5) ** 2;
            field.current[cell] = Math.min(1, field.current[cell] + impulse);
        }
    }
}

export function advanceWaveField(field: ReturnType<typeof createWaveField>, space: number) {
    'worklet';
    const { current, prev } = field;
    const damping = 0.94 + 0.031 * space;
    for (let row = 1; row < WAVE_ROWS - 1; row += 1) {
        for (let column = 1; column < WAVE_COLUMNS - 1; column += 1) {
            const cell = row * WAVE_COLUMNS + column;
            const neighbors =
                current[cell - 1] + current[cell + 1] + current[cell - WAVE_COLUMNS] + current[cell + WAVE_COLUMNS];
            const edgeDamping =
                row === 1 || row === WAVE_ROWS - 2 || column === 1 || column === WAVE_COLUMNS - 2 ? 0.9 : 1;
            prev[cell] =
                (2 * current[cell] - prev[cell] + 0.16 * (neighbors - 4 * current[cell])) * damping * edgeDamping;
        }
    }
    field.current = prev;
    field.prev = current;
}
