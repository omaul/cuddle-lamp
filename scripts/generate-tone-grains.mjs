import { readFileSync, writeFileSync } from 'node:fs';

const PLATE = {
    width: 0.230,
    height: 0.290,
    thickness: 0.0008,
    young: 69e9,
    density: 2700,
    poisson: 0.33,
    damping: 0.008,
    driveX: 0.31,
    driveY: 0.43,
};
const MODES = 64;
const CHECK_MODES = 80;
const GRID_WIDTH = 240;
const GRID_HEIGHT = Math.round(GRID_WIDTH * PLATE.height / PLATE.width);
const MARGIN = 0.045;
const EDGE_TAPER = 0.055;
const GRAIN_COUNT = 4096;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function getModes(gridSize, modeCount) {
    return Array.from({ length: gridSize }, (_, index) => {
        const position = MARGIN + (1 - 2 * MARGIN) * (index + 0.5) / gridSize;
        return Float64Array.from({ length: modeCount }, (_, mode) => Math.sin((mode + 1) * Math.PI * position));
    });
}

function calculateResponse(frequency, modeCount) {
    const { width, height, thickness, young, density, poisson, damping, driveX, driveY } = PLATE;
    const stiffness = young * thickness ** 3 / (12 * (1 - poisson ** 2));
    const mass = density * thickness * width * height / 4;
    const bending = Math.sqrt(stiffness / (density * thickness));
    const omega = 2 * Math.PI * frequency;
    const real = new Float64Array(modeCount * modeCount);
    const imaginary = new Float64Array(real.length);
    for (let m = 1; m <= modeCount; m++) {
        for (let n = 1; n <= modeCount; n++) {
            const natural = bending * ((m * Math.PI / width) ** 2 + (n * Math.PI / height) ** 2);
            const shift = natural ** 2 - omega ** 2;
            const loss = 2 * damping * natural * omega;
            const force = Math.sin(m * Math.PI * driveX) * Math.sin(n * Math.PI * driveY);
            const inverse = force / (mass * (shift ** 2 + loss ** 2));
            const index = (m - 1) * modeCount + n - 1;
            real[index] = shift * inverse;
            imaginary[index] = -loss * inverse;
        }
    }
    const xModes = getModes(GRID_WIDTH, modeCount);
    const yModes = getModes(GRID_HEIGHT, modeCount);
    const rowReal = new Float64Array(modeCount);
    const rowImaginary = new Float64Array(modeCount);
    const amplitudes = new Float64Array(GRID_WIDTH * GRID_HEIGHT);
    for (let y = 0; y < GRID_HEIGHT; y++) {
        rowReal.fill(0);
        rowImaginary.fill(0);
        for (let m = 0; m < modeCount; m++) {
            for (let n = 0; n < modeCount; n++) {
                const index = m * modeCount + n;
                rowReal[m] += real[index] * yModes[y][n];
                rowImaginary[m] += imaginary[index] * yModes[y][n];
            }
        }
        for (let x = 0; x < GRID_WIDTH; x++) {
            let inPhase = 0;
            let outOfPhase = 0;
            for (let m = 0; m < modeCount; m++) {
                inPhase += rowReal[m] * xModes[x][m];
                outOfPhase += rowImaginary[m] * xModes[x][m];
            }
            amplitudes[y * GRID_WIDTH + x] = Math.hypot(inPhase, outOfPhase);
        }
    }
    return amplitudes;
}

function getRms(values) {
    return Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0) / values.length);
}

function findCell(cumulative, value) {
    let start = 0;
    let end = cumulative.length - 1;
    while (start < end) {
        const middle = (start + end) >>> 1;
        if (value < cumulative[middle]) end = middle;
        else start = middle + 1;
    }
    const lower = start === 0 ? 0 : cumulative[start - 1];
    return start + (value - lower) / (cumulative[start] - lower);
}

function getGrains(weights) {
    const rows = [];
    const rowTotals = new Float64Array(GRID_HEIGHT);
    let total = 0;
    for (let y = 0; y < GRID_HEIGHT; y++) {
        const row = new Float64Array(GRID_WIDTH);
        let sum = 0;
        for (let x = 0; x < GRID_WIDTH; x++) {
            sum += weights[y * GRID_WIDTH + x];
            row[x] = sum;
        }
        rows.push(row);
        total += sum;
        rowTotals[y] = total;
    }

    // Общие квантили для всех фигур сохраняют порядок песчинок поперёк и вдоль пластины.
    let seed = 151;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
    };
    return Array.from({ length: GRAIN_COUNT }, () => {
        const row = findCell(rowTotals, random() * total);
        const columns = rows[Math.floor(row)];
        const column = findCell(columns, random() * columns[GRID_WIDTH - 1]);
        return [column / GRID_WIDTH, row / GRID_HEIGHT].map(position => {
            return Math.round((MARGIN + position * (1 - 2 * MARGIN)) * 4095);
        });
    });
}

function getEdgeWeight(index) {
    const x = (index % GRID_WIDTH + 0.5) / GRID_WIDTH;
    const y = (Math.floor(index / GRID_WIDTH) + 0.5) / GRID_HEIGHT;
    const distance = Math.min(x, y, 1 - x, 1 - y);
    const progress = Math.min(1, distance / EDGE_TAPER);
    return progress ** 2 * (3 - 2 * progress);
}

function formatTargets(figures) {
    const rows = [
        '#pragma once',
        '',
        '// Получено из scripts/generate-tone-grains.mjs.',
        'namespace lamp::toneGrains {',
        'struct Target { int frequencyHz; const char *points; };',
        '',
        'inline constexpr int grainCount = ' + GRAIN_COUNT + ';',
        'inline constexpr double plateAspect = ' + PLATE.width + ' / ' + PLATE.height + ';',
        'inline constexpr char alphabet[] = "' + ALPHABET + '";',
        'inline constexpr Target targets[] = {',
    ];
    for (const { frequency, grains } of figures) {
        rows.push('    {' + frequency + ',');
        for (let first = 0; first < grains.length; first += 24) {
            const data = grains.slice(first, first + 24).flatMap(point => {
                return point.map(value => ALPHABET[value >> 6] + ALPHABET[value & 63]);
            }).join('');
            rows.push('        "' + data + '"');
        }
        rows.push('    },');
    }
    rows.push('};', '}', '');
    return rows.join('\n');
}

const SHEET = { tileWidth: 248, tileHeight: 310, plateWidth: 204, plateHeight: 257, marginX: 22, marginY: 12 };
const COLORS = ['#827565', '#aa997f', '#c9b697', '#efdbc0'];

function formatSheet(figures) {
    const { tileWidth, tileHeight, plateWidth, plateHeight, marginX, marginY } = SHEET;
    const width = 3 * tileWidth;
    const height = 3 * tileHeight;
    const lines = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" role="img">',
        '  <title>Фигуры Хладни для девяти тонов сольфеджио</title>',
        '  <desc>Одна алюминиевая пластина 230 × 290 × 0,8 мм с шарнирным опиранием.</desc>',
        '  <rect width="100%" height="100%" fill="#131110"/>',
    ];
    for (const [index, { frequency, grains }] of figures.entries()) {
        const x = index % 3 * tileWidth + marginX;
        const y = Math.floor(index / 3) * tileHeight + marginY;
        lines.push('  <g transform="translate(' + x + ' ' + y + ')">');
        lines.push('    <rect width="' + plateWidth + '" height="' + plateHeight + '" rx="5" fill="#231f1c" stroke="#564b40"/>');
        for (const [shade, color] of COLORS.entries()) {
            const first = shade * GRAIN_COUNT / COLORS.length;
            const last = (shade + 1) * GRAIN_COUNT / COLORS.length;
            const path = grains.slice(first, last).map(([grainX, grainY]) => {
                return 'M' + Math.round(grainX * plateWidth / 4095) + ' ' + Math.round(grainY * plateHeight / 4095) + 'h0.7';
            }).join('');
            lines.push('    <path fill="none" stroke="' + color + '" stroke-width="0.85" d="' + path + '"/>');
        }
        lines.push('    <text x="' + plateWidth / 2 + '" y="' + (plateHeight + 29) + '" text-anchor="middle" fill="#eee7de" font-family="sans-serif" font-size="16">' + frequency + ' Гц</text>');
        lines.push('  </g>');
    }
    lines.push('</svg>', '');
    return lines.join('\n');
}

function generate(frequencies) {
    const figures = frequencies.map(frequency => {
        const response = calculateResponse(frequency, MODES);
        const reference = calculateResponse(frequency, CHECK_MODES);
        const rms = getRms(response);
        const error = getRms(response.map((value, index) => value - reference[index])) / rms;
        const sorted = response.slice().sort();
        const limit = Math.max(0.04 * rms, sorted[Math.floor(sorted.length * 0.13)]);
        const weights = response.map((value, index) => 0.012 + getEdgeWeight(index) * Math.exp(-((value / limit) ** 2)));
        return { frequency, grains: getGrains(weights), weights, rms, error };
    });
    const result = figures.map(({ frequency, rms, error }) => [frequency, rms * 1e6, error * 100]);
    let closest = { frequencies: [], overlap: 0 };
    for (const [index, figure] of figures.entries()) {
        const length = getRms(figure.weights);
        for (const other of figures.slice(index + 1)) {
            const dot = figure.weights.reduce((sum, weight, cell) => sum + weight * other.weights[cell], 0);
            const overlap = dot / (figure.weights.length * length * getRms(other.weights));
            if (overlap > closest.overlap) closest = { frequencies: [figure.frequency, other.frequency], overlap };
        }
    }
    return { figures, modeCheck: result, closest, targets: formatTargets(figures), sheet: formatSheet(figures) };
}

const scene = JSON.parse(readFileSync(new URL('../scenes/solfeggio.json', import.meta.url), 'utf8'));
const { values: frequencies } = scene.knobs.find(knob => knob.id === 'frequency').choices;
const { modeCheck, closest, targets, sheet } = generate(frequencies);
writeFileSync(new URL('../ios/CuddleLamp/ToneGrainsTargets.h', import.meta.url), targets);
writeFileSync(new URL('../docs/solfeggio-chladni.svg', import.meta.url), sheet);
console.table(modeCheck.map(([frequencyHz, rmsMicrometers, truncationPercent]) => ({
    'частота, Гц': frequencyHz,
    'отклик RMS, мкм/Н': rmsMicrometers.toFixed(2),
    'расхождение с 80 × 80 модами, %': truncationPercent.toFixed(3),
})));
console.log('Наиболее близкие распределения:', closest.frequencies.join(' ↔ '), 'Гц, косинусная близость', closest.overlap.toFixed(3));
