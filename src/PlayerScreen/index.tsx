import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Keyboard,
    Modal,
    PanResponder,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from 'react-native';
import Choice from '../components/Choice';
import Knob from '../components/Knob';
import SceneVisual from '../components/SceneVisual';
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

const Overlay = Platform.OS === 'ios' ? SafeAreaView : View;

const STATUS_LABELS: Record<PlayerStatus, string> = {
    loading: 'Загрузка',
    paused: 'Пауза',
    playing: 'Воспроизведение',
    fading: 'Затухание',
    error: 'Ошибка',
};
const PANEL_TITLES = {
    settings: 'Настройки',
    timer: 'Таймер сна',
    tools: 'Инструменты разработки',
};
const STATUSES = Object.keys(STATUS_LABELS) as PlayerStatus[];
const TIMERS = [
    { title: 'Выкл.', seconds: null },
    { title: '15 мин', seconds: 900 },
    { title: '30 мин', seconds: 1800 },
    { title: '60 мин', seconds: 3600 },
];

const PlayerScreen: React.FC<PlayerScreenProps> = ({
    scenes,
    snapshot,
    error,
    onScene,
    onPlaying,
    onKnob,
    onTimer,
    onScenario,
    onImport,
}) => {
    const { height } = useWindowDimensions();
    const [selectedKnobBySceneId, setSelectedKnobBySceneId] = useState<Record<string, string>>({});
    const [sceneJson, setSceneJson] = useState('');
    const [openPanel, setOpenPanel] = useState<keyof typeof PANEL_TITLES | null>(null);
    const [sheetOffset] = useState(() => new Animated.Value(0));
    const [sheetProgress] = useState(() => new Animated.Value(0));
    const sheetTranslation = useMemo(
        () => Animated.add(sheetOffset, sheetProgress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] })),
        [height, sheetOffset, sheetProgress],
    );
    const handleClosePanel = useCallback(() => {
        Animated.timing(sheetProgress, {
            toValue: 0,
            duration: 180,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (finished) {
                setOpenPanel(null);
            }
        });
    }, [sheetProgress]);
    const gripStartY = useRef(0);
    const resetSheetOffset = useCallback(() => {
        Animated.spring(sheetOffset, { toValue: 0, useNativeDriver: true }).start();
    }, [sheetOffset]);
    const sheetDrag = useMemo(() => {
        return PanResponder.create({
            onMoveShouldSetPanResponderCapture: (_, { dx, dy }) => dy > 4 && dy > Math.abs(dx),
            onPanResponderMove: (_, { dy }) => sheetOffset.setValue(Math.max(dy, 0)),
            onPanResponderRelease: (_, { dy, vy }) => {
                if (dy > 48 || (dy > 12 && vy > 0.45)) {
                    handleClosePanel();
                } else {
                    resetSheetOffset();
                }
            },
            onPanResponderTerminate: resetSheetOffset,
        });
    }, [handleClosePanel, resetSheetOffset, sheetOffset]);
    const PanelContent = openPanel === 'tools' ? ScrollView : View;
    const scene = scenes.find((item) => item.id === snapshot.sceneId);
    const knobLabels = (snapshot.knobLabels ?? scene?.knobs ?? []).filter(
        (knob) => snapshot.knobs[knob.id] !== undefined,
    );
    const sceneId = snapshot.sceneId ?? '';
    const activeKnob = knobLabels.find((knob) => knob.id === selectedKnobBySceneId[sceneId]) ?? knobLabels[0];
    const isPlaying = snapshot.status === 'playing' || snapshot.status === 'fading';
    const canPlay = snapshot.status !== 'loading' && snapshot.status !== 'error' && snapshot.sceneId !== null;
    const remainingSeconds = snapshot.remainingSeconds;
    const timerLabel =
        remainingSeconds === null
            ? 'Выключен'
            : `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;

    return (
        <View style={styles.screen}>
            <SceneVisual key={sceneId} sceneId={snapshot.sceneId} isPlaying={isPlaying} rms={snapshot.rms} />
            <Overlay style={styles.screen}>
                <View style={styles.content}>
                    <View style={styles.topBar}>
                        <ScrollView
                            horizontal
                            bounces={false}
                            style={styles.sceneStrip}
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.scenes}
                        >
                            {scenes.map((item) => {
                                const isSelected = item.id === snapshot.sceneId;
                                return (
                                    <Pressable
                                        key={item.id}
                                        accessibilityRole="tab"
                                        accessibilityState={{ selected: isSelected }}
                                        onPress={() => onScene(item)}
                                        style={({ pressed }) => [
                                            styles.scene,
                                            isSelected && styles.activeScene,
                                            pressed && styles.pressed,
                                        ]}
                                    >
                                        <Text style={[styles.sceneLabel, isSelected && styles.accentText]}>
                                            {item.name}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Настройки"
                            accessibilityState={{ expanded: openPanel === 'settings' || openPanel === 'tools' }}
                            onPress={() => {
                                sheetOffset.setValue(0);
                                setOpenPanel('settings');
                            }}
                            style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}
                        >
                            <Text style={styles.gear}>{'⚙︎'}</Text>
                        </Pressable>
                    </View>
                    <View pointerEvents="none" style={styles.visualSpace} />
                    <View style={styles.hero}>
                        <View style={styles.heroText}>
                            <Text accessibilityRole="header" style={styles.title}>
                                {snapshot.sceneName ?? scene?.name ?? 'Плеер'}
                            </Text>
                            <Text accessibilityLiveRegion="polite" style={styles.secondary}>
                                {STATUS_LABELS[snapshot.status]}
                            </Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={isPlaying ? 'Приостановить' : 'Воспроизвести'}
                            accessibilityState={{ disabled: !canPlay }}
                            disabled={!canPlay}
                            onPress={() => onPlaying(!isPlaying)}
                            style={({ pressed }) => [styles.play, (pressed || !canPlay) && styles.pressed]}
                        >
                            {isPlaying ? (
                                <View style={styles.pauseIcon}>
                                    <View style={styles.pauseBar} />
                                    <View style={styles.pauseBar} />
                                </View>
                            ) : (
                                <View style={styles.playIcon} />
                            )}
                        </Pressable>
                    </View>
                    {error && (
                        <Text accessibilityRole="alert" style={styles.error}>
                            {error}
                        </Text>
                    )}
                    <View style={styles.panel}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Таймер сна, ${timerLabel}`}
                            accessibilityState={{ expanded: openPanel === 'timer' }}
                            onPress={() => {
                                sheetOffset.setValue(0);
                                setOpenPanel('timer');
                            }}
                            style={styles.row}
                        >
                            <Text style={styles.rowTitle}>Таймер сна</Text>
                            <Text style={[styles.secondary, remainingSeconds !== null && styles.accentText]}>
                                {timerLabel} ›
                            </Text>
                        </Pressable>
                    </View>
                    {activeKnob && (
                        <View style={styles.soundPanel}>
                            <Knob
                                key={`${sceneId}/${activeKnob.id}`}
                                title={activeKnob.name}
                                value={snapshot.knobs[activeKnob.id]}
                                disabled={!canPlay}
                                onChange={(next) => onKnob(activeKnob.id, next)}
                            />
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.parameters}
                            >
                                {knobLabels.map((knob) => {
                                    const isSelected = knob.id === activeKnob.id;
                                    return (
                                        <Pressable
                                            key={knob.id}
                                            accessibilityRole="tab"
                                            accessibilityState={{ selected: isSelected }}
                                            onPress={() =>
                                                setSelectedKnobBySceneId((items) => ({
                                                    ...items,
                                                    [sceneId]: knob.id,
                                                }))
                                            }
                                            style={[styles.parameter, isSelected && styles.activeScene]}
                                        >
                                            <Text style={[styles.sceneLabel, isSelected && styles.accentText]}>
                                                {knob.name}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    )}
                </View>
            </Overlay>
            <Modal
                transparent
                visible={openPanel !== null}
                onShow={() => {
                    Animated.timing(sheetProgress, {
                        toValue: 1,
                        duration: 280,
                        easing: Easing.out(Easing.cubic),
                        useNativeDriver: true,
                    }).start();
                }}
                onRequestClose={handleClosePanel}
            >
                <View style={styles.modalLayout}>
                    <Animated.View pointerEvents="none" style={[styles.backdrop, { opacity: sheetProgress }]} />
                    <Pressable
                        accessible={false}
                        importantForAccessibility="no"
                        onPress={handleClosePanel}
                        style={styles.dismissArea}
                    />
                    <Animated.View
                        style={[styles.sheet, { transform: [{ translateY: sheetTranslation }] }]}
                        accessibilityViewIsModal
                        onAccessibilityEscape={handleClosePanel}
                        {...(openPanel === 'tools' ? {} : sheetDrag.panHandlers)}
                    >
                        <Overlay style={styles.sheetContent}>
                            <View {...(openPanel === 'tools' ? sheetDrag.panHandlers : {})}>
                                <View
                                    collapsable={false}
                                    style={styles.grabArea}
                                    onStartShouldSetResponder={() => true}
                                    onResponderGrant={({ nativeEvent }) => {
                                        gripStartY.current = nativeEvent.pageY;
                                        sheetOffset.stopAnimation();
                                    }}
                                    onResponderMove={({ nativeEvent }) => {
                                        sheetOffset.setValue(Math.max(0, nativeEvent.pageY - gripStartY.current));
                                    }}
                                    onResponderRelease={({ nativeEvent }) => {
                                        if (nativeEvent.pageY - gripStartY.current >= 24) {
                                            handleClosePanel();
                                        } else {
                                            resetSheetOffset();
                                        }
                                    }}
                                    onResponderTerminationRequest={() => false}
                                    onResponderTerminate={resetSheetOffset}
                                >
                                    <View pointerEvents="none" style={styles.grabber} />
                                </View>
                                <View style={styles.sheetHeader}>
                                    {openPanel === 'tools' && (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="Назад"
                                            onPress={() => setOpenPanel('settings')}
                                            style={styles.sheetAction}
                                        >
                                            <View style={styles.backIcon} />
                                        </Pressable>
                                    )}
                                    <Text accessibilityRole="header" style={styles.sheetTitle}>
                                        {openPanel && PANEL_TITLES[openPanel]}
                                    </Text>
                                </View>
                            </View>
                            <PanelContent
                                {...(openPanel === 'tools' && {
                                    keyboardShouldPersistTaps: 'handled',
                                    automaticallyAdjustKeyboardInsets: true,
                                    bounces: false,
                                })}
                            >
                                {__DEV__ && openPanel === 'settings' && (onScenario || onImport) && (
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="DEV, инструменты разработки"
                                        onPress={() => setOpenPanel('tools')}
                                        style={({ pressed }) => [styles.row, styles.panel, pressed && styles.pressed]}
                                    >
                                        <Text style={styles.rowTitle}>DEV</Text>
                                        <Text style={styles.secondary}>Инструменты разработки ›</Text>
                                    </Pressable>
                                )}
                                {openPanel === 'timer' && (
                                    <View style={styles.choices}>
                                        {TIMERS.map(({ title, seconds }) => (
                                            <Choice
                                                key={title}
                                                title={title}
                                                selected={seconds === null && remainingSeconds === null}
                                                disabled={!canPlay}
                                                onPress={() => {
                                                    onTimer(seconds);
                                                    handleClosePanel();
                                                }}
                                            />
                                        ))}
                                    </View>
                                )}
                                {__DEV__ && openPanel === 'tools' && onScenario && (
                                    <>
                                        <Text accessibilityRole="header" style={styles.heading}>
                                            Тестовые состояния
                                        </Text>
                                        <View style={styles.choices}>
                                            {STATUSES.map((status) => (
                                                <Choice
                                                    key={status}
                                                    title={STATUS_LABELS[status]}
                                                    onPress={() => onScenario(status)}
                                                />
                                            ))}
                                            <Choice
                                                title="Запуск с таймером на 5 с"
                                                onPress={() => {
                                                    onScenario('playing');
                                                    onTimer(5);
                                                }}
                                            />
                                        </View>
                                    </>
                                )}
                                {__DEV__ && openPanel === 'tools' && onImport && (
                                    <Choice
                                        title="5 с для проверки"
                                        disabled={!canPlay}
                                        onPress={() => {
                                            onTimer(5);
                                            handleClosePanel();
                                        }}
                                    />
                                )}
                                {__DEV__ && openPanel === 'tools' && onImport && (
                                    <>
                                        <Text accessibilityRole="header" style={styles.heading}>
                                            Импорт из студии
                                        </Text>
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
                                                handleClosePanel();
                                                onImport(sceneJson);
                                            }}
                                        />
                                    </>
                                )}
                            </PanelContent>
                        </Overlay>
                    </Animated.View>
                </View>
            </Modal>
        </View>
    );
};

export default PlayerScreen;
