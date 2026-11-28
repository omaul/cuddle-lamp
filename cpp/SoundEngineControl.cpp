#include "SoundEngineControl.h"

#include <memory>
#include <stdexcept>

namespace facebook::react {

SoundEngineControl &SoundEngineControl::shared() {
    static SoundEngineControl control;
    return control;
}

void SoundEngineControl::attach(SoundEngine *engine) {
    std::lock_guard lock(mutex_);
    engine_ = engine;
    outputAvailable_ = engine != nullptr;
}

void SoundEngineControl::setOutputAvailable(bool available) {
    std::lock_guard lock(mutex_);
    outputAvailable_ = available && engine_ != nullptr;
}

std::string SoundEngineControl::readSnapshot() {
    std::lock_guard lock(mutex_);
    if (!outputAvailable_) {
        throw std::runtime_error("Звуковой вывод недоступен");
    }
    std::unique_ptr<char, decltype(&sound_engine_free_snapshot)> snapshot(
        sound_engine_copy_snapshot(engine_), sound_engine_free_snapshot);
    if (!snapshot) {
        throw std::runtime_error("Звуковой движок недоступен");
    }
    return snapshot.get();
}

template <typename Action>
uint32_t SoundEngineControl::submit(Action action, bool allowUnavailable) {
    std::lock_guard lock(mutex_);
    if (engine_ && !outputAvailable_ && !allowUnavailable) {
        throw std::runtime_error("Звуковой вывод восстанавливается");
    }
    if (!engine_ || action(engine_) != SOUND_ENGINE_OK) {
        throw std::runtime_error(sound_engine_last_error(engine_));
    }
    return sound_engine_queued_command(engine_);
}

uint32_t SoundEngineControl::loadScene(const std::string &json, const std::string &knobsJson) {
    return submit([&](auto *engine) {
        return sound_engine_load_scene_with_knobs(engine, json.c_str(), knobsJson.c_str());
    });
}

uint32_t SoundEngineControl::setPlaying(bool playing) {
    return submit([&](auto *engine) {
        return playing ? sound_engine_play(engine) : sound_engine_pause(engine);
    }, !playing);
}

uint32_t SoundEngineControl::setKnob(const std::string &sceneId, const std::string &id, double value) {
    return submit([&](auto *engine) {
        return sound_engine_set_scene_knob(engine, sceneId.c_str(), id.c_str(), value);
    });
}

uint32_t SoundEngineControl::resetKnobs(const std::string &sceneId) {
    return submit([&](auto *engine) { return sound_engine_reset_scene_knobs(engine, sceneId.c_str()); });
}

uint32_t SoundEngineControl::setTimer(double seconds) {
    return submit([&](auto *engine) { return sound_engine_set_timer(engine, seconds); });
}

uint32_t SoundEngineControl::extendTimer(double seconds) {
    return submit([&](auto *engine) { return sound_engine_extend_timer(engine, seconds); });
}

void SoundEngineControl::setVolume(double volume) {
    submit([&](auto *engine) { return sound_engine_set_volume(engine, volume); });
}

} // namespace facebook::react
