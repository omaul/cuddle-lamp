const durations = {
    focus: 24000,
    relax: 19000,
    sleep: 30000,
};

export function getSceneDuration(sceneId: string | null) {
    switch (sceneId) {
        case 'focus':
        case 'relax':
        case 'sleep':
            return durations[sceneId];
        default: {
            let hash = 0;
            for (const character of sceneId ?? '') {
                hash = (hash * 31 + character.charCodeAt(0)) % 4294967296;
            }
            return 24000 + (hash % 18000);
        }
    }
}
