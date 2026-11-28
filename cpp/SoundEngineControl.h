#pragma once

#include "sound_engine.h"

#include <mutex>
#include <string>

namespace facebook::react {

class SoundEngineControl {
public:
    static SoundEngineControl &shared();
    void attach(SoundEngine *engine);
    void setOutputAvailable(bool available);
    std::string readSnapshot();
    uint32_t loadScene(const std::string &json, const std::string &knobsJson);
    uint32_t setPlaying(bool playing);
    uint32_t setKnob(const std::string &sceneId, const std::string &id, double value);
    uint32_t resetKnobs(const std::string &sceneId);
    uint32_t setTimer(double seconds);
    uint32_t extendTimer(double seconds);
    void setVolume(double volume);

private:
    template <typename Action>
    uint32_t submit(Action action, bool allowUnavailable = false);
    std::mutex mutex_;
    SoundEngine *engine_ = nullptr;
    bool outputAvailable_ = false;
};

} // namespace facebook::react
