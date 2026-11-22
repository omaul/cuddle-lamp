import React, { useRef, useState } from 'react';
import { Keyboard, ScrollView, Text, TextInput, View } from 'react-native';
import Choice from '../components/Choice';
import Knob from '../components/Knob';
import type { Scene } from '../player/catalog';
import type { PlayerSnapshot, PlayerStatus } from '../player/Player';
import styles from './styles';

interface PlayerScreenProps {
    scenes: readonly Scene[];
    snapshot: PlayerSnapshot;
    error?: string;
    onScene: (scene: Scene) => void;
    onPlaying: (isPlaying: boolean) => void;
    onKnob: (id: string, value: number) => void;
    onTimer: (seconds: number | null) => void;
    onScenario?: (status: PlayerStatus) => void;
    onImport?: (json: string) => void;
}

const STATUS_LABELS: Record<PlayerStatus, string> = {
    loading: 'Загрузка',
    paused: 'Пауза',
    playing: 'Воспроизведение',
    fading: 'Затухание',
    error: 'Ошибка',
};
const STATUSES = Object.keys(STATUS_LABELS) as PlayerStatus[];
const TIMERS = [
    { title: 'Выкл.', seconds: null },
    { title: '15 мин', seconds: 900 },
    { title: '30 мин', seconds: 1800 },
    { title: '60 мин', seconds: 3600 },
];

const PlayerScreen: React.FC<PlayerScreenProps> = ({
    scenes, snapshot, error, onScene, onPlaying, onKnob, onTimer, onScenario, onImport,
}) => {
    const [sceneJson, setSceneJson] = useState('');
    const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
    const scene = scenes.find(item => item.id === snapshot.sceneId);
    const knobLabels = snapshot.knobLabels ?? scene?.knobs;
    const isPlaying = snapshot.status === 'playing' || snapshot.status === 'fading';
    const canPlay = snapshot.status !== 'loading' && snapshot.status !== 'error' && snapshot.sceneId !== null;
    const remainingSeconds = snapshot.remainingSeconds;
    const timerLabel = remainingSeconds === null
        ? 'Таймер выключен'
        : `Осталось ${Math.floor(remainingSeconds / 60)} мин ${remainingSeconds % 60} с`;

    return (
        <ScrollView
            ref={scroll}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
        >
            <View style={styles.content}>
                <View style={styles.hero}>
                    <Text accessibilityRole="header" style={styles.title}>{snapshot.sceneName ?? scene?.name ?? 'Плеер'}</Text>
                    <Text accessibilityLiveRegion="polite" style={styles.secondary}>
                        {STATUS_LABELS[snapshot.status]}
                    </Text>
                    <View accessible={false} style={styles.meter}>
                        <View style={[styles.meterFill, { width: `${Math.min(snapshot.rms * 300, 100)}%` }]} />
                    </View>
                    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
                    <Choice
                        title={isPlaying ? 'Приостановить' : 'Воспроизвести'}
                        primary
                        disabled={!canPlay}
                        onPress={() => onPlaying(!isPlaying)}
                    />
                </View>
                <Text accessibilityRole="header" style={styles.heading}>Сцены</Text>
                <View style={styles.choices}>
                    {scenes.map(item => (
                        <Choice key={item.id} title={item.name} selected={item.id === scene?.id} onPress={() => onScene(item)} />
                    ))}
                </View>
                {knobLabels?.map(knob => {
                    const value = snapshot.knobs[knob.id];
                    if (value === undefined) {
                        return null;
                    }
                    return (
                        <Knob
                            key={`${snapshot.sceneId}/${knob.id}`}
                            title={knob.name}
                            value={value}
                            disabled={!canPlay}
                            onChange={next => onKnob(knob.id, next)}
                        />
                    );
                })}
                <Text accessibilityRole="header" style={styles.heading}>Таймер</Text>
                <Text style={styles.secondary}>{timerLabel}</Text>
                <View style={styles.choices}>
                    {TIMERS.map(({ title, seconds }) => (
                        <Choice
                            key={title}
                            title={title}
                            selected={seconds === null && remainingSeconds === null}
                            disabled={!canPlay}
                            onPress={() => onTimer(seconds)}
                        />
                    ))}
                    {__DEV__ && onImport && (
                        <Choice title="5 с для проверки" disabled={!canPlay} onPress={() => onTimer(5)} />
                    )}
                </View>
                {__DEV__ && onScenario && (
                    <>
                        <Text accessibilityRole="header" style={styles.heading}>Тестовые состояния</Text>
                        <View style={styles.choices}>
                            {STATUSES.map(status => (
                                <Choice key={status} title={STATUS_LABELS[status]} onPress={() => onScenario(status)} />
                            ))}
                            <Choice title="Запуск с таймером на 5 с" onPress={() => {
                                onScenario('playing');
                                onTimer(5);
                            }} />
                        </View>
                    </>
                )}
                {__DEV__ && onImport && (
                    <>
                        <Text accessibilityRole="header" style={styles.heading}>Импорт из студии</Text>
                        <TextInput
                            accessibilityLabel="JSON сцены"
                            placeholder="Вставьте JSON сцены"
                            placeholderTextColor={styles.input.color}
                            multiline
                            autoCorrect={false}
                            autoCapitalize="none"
                            spellCheck={false}
                            style={styles.input}
                            value={sceneJson}
                            onChangeText={setSceneJson}
                        />
                        <Choice
                            title="Загрузить сцену"
                            disabled={sceneJson.trim().length === 0}
                            onPress={() => {
                                Keyboard.dismiss();
                                scroll.current?.scrollTo({ y: 0 });
                                onImport(sceneJson);
                            }}
                        />
                    </>
                )}
            </View>
        </ScrollView>
    );
};

export default PlayerScreen;
