/*
 * C-интерфейс ядра генеративного звука.
 *
 * Функции управления (load_scene, play, pause, set_knob, set_timer, set_volume, last_error)
 * вызываются из одного потока или под внешней синхронизацией, но не из аудиопотока:
 * загрузка сцены выделяет память.
 * sound_engine_render не выделяет память и не берёт блокировок. Вызовы рендера не пересекаются.
 * sound_engine_get_state можно вызывать из любого потока.
 *
 * Реализация — core/crates/sound-ffi/src/lib.rs. Коды и поля здесь должны совпадать с ней.
 */

#ifndef SOUND_ENGINE_H
#define SOUND_ENGINE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SOUND_ENGINE_OK 0
#define SOUND_ENGINE_ERROR_INVALID_ARGUMENT 1
#define SOUND_ENGINE_ERROR_SCENE 2
#define SOUND_ENGINE_ERROR_UNKNOWN_KNOB 3
#define SOUND_ENGINE_ERROR_QUEUE_FULL 4
#define SOUND_ENGINE_ERROR_PROCESSOR_GONE 5
#define SOUND_ENGINE_ERROR_SCENE_CHANGED 6

#define SOUND_ENGINE_STATUS_IDLE 0
#define SOUND_ENGINE_STATUS_PAUSED 1
#define SOUND_ENGINE_STATUS_PLAYING 2
#define SOUND_ENGINE_STATUS_STOPPING 3

typedef struct SoundEngine SoundEngine;

typedef struct SoundEngineState {
    /* Одно из значений SOUND_ENGINE_STATUS_*. */
    int32_t status;
    /* Секунды до срабатывания таймера или -1, если таймер выключен. */
    float timer_remaining_seconds;
    /* Сглаженная громкость выхода (RMS) для анимации. */
    float level;
    /* Номер последней команды, которую обработал аудиопоток. */
    uint32_t applied_command;
} SoundEngineState;

/* Создаёт движок. Возвращает NULL, если частота дискретизации вне 8–384 кГц. */
SoundEngine *sound_engine_create(float sample_rate);

/* Уничтожает движок. Аудиопоток к этому моменту должен быть остановлен. */
void sound_engine_destroy(SoundEngine *engine);

/* Загружает сцену из JSON в UTF-8. Если звук играет, новая сцена плавно сменяет старую. */
int32_t sound_engine_load_scene(SoundEngine *engine, const char *scene_json);

/* Запускает звук с плавным появлением. Без загруженной сцены ничего не делает. */
int32_t sound_engine_play(SoundEngine *engine);

/* Плавно затихает и встаёт на паузу. */
int32_t sound_engine_pause(SoundEngine *engine);

/* Ставит ручку текущей сцены в положение от 0 до 1. */
int32_t sound_engine_set_knob(SoundEngine *engine, const char *knob_id, float position);

/* Ставит ручку только в сцене, для которой отправлена команда. Положение должно быть конечным. */
int32_t sound_engine_set_scene_knob(SoundEngine *engine, const char *scene_id, const char *knob_id, float position);

/* Включает таймер на seconds секунд игры, ноль или отрицательное значение выключает его. */
int32_t sound_engine_set_timer(SoundEngine *engine, float seconds);

/* Задаёт общую громкость от 0 до 1. */
int32_t sound_engine_set_volume(SoundEngine *engine, float volume);

/*
 * Текст ошибки последней функции управления, пустая строка, если ошибки не было.
 * Указатель живёт до следующего вызова функции управления.
 */
const char *sound_engine_last_error(const SoundEngine *engine);

/* Заполняет frames отсчётов в каждом из двух непересекающихся буферов.
 * При frames == 0 обрабатывает команды без продвижения звука, буферы могут быть NULL.
 */
void sound_engine_render(SoundEngine *engine, float *left, float *right, uint32_t frames);

/* Состояние плеера. Можно вызывать из любого потока. */
SoundEngineState sound_engine_get_state(const SoundEngine *engine);

/* Номер последней команды в очереди. Вызывается на управляющей стороне. */
uint32_t sound_engine_queued_command(const SoundEngine *engine);

/* Снимок в JSON со сценой, ручками и звучащими колокольчиками (нота MIDI и уровень). Вызывается на управляющей стороне. */
char *sound_engine_copy_snapshot(SoundEngine *engine);

/* Освобождает строку, полученную через sound_engine_copy_snapshot. */
void sound_engine_free_snapshot(char *snapshot);

#ifdef __cplusplus
}
#endif

#endif /* SOUND_ENGINE_H */
