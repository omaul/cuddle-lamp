#include "SoundEngineModule.h"
#include "SoundEngineControl.h"

#include <utility>

namespace facebook::react {

SoundEngineModule::SoundEngineModule(std::shared_ptr<CallInvoker> invoker, std::function<void(bool)> prepareTransport)
    : NativeSoundEngineCxxSpec(std::move(invoker)), prepareTransport_(std::move(prepareTransport)) {}

std::string SoundEngineModule::readSnapshot(jsi::Runtime &) {
    return SoundEngineControl::shared().readSnapshot();
}

double SoundEngineModule::loadScene(jsi::Runtime &, const std::string &json, const std::string &knobsJson) {
    return SoundEngineControl::shared().loadScene(json, knobsJson);
}

double SoundEngineModule::setPlaying(jsi::Runtime &, bool playing) {
    if (prepareTransport_) {
        prepareTransport_(playing);
    }
    return SoundEngineControl::shared().setPlaying(playing);
}

double SoundEngineModule::setKnob(jsi::Runtime &, const std::string &sceneId, const std::string &id, double value) {
    return SoundEngineControl::shared().setKnob(sceneId, id, value);
}

double SoundEngineModule::resetKnobs(jsi::Runtime &, const std::string &sceneId) {
    return SoundEngineControl::shared().resetKnobs(sceneId);
}

double SoundEngineModule::setTimer(jsi::Runtime &, double seconds) {
    return SoundEngineControl::shared().setTimer(seconds);
}

double SoundEngineModule::extendTimer(jsi::Runtime &, double seconds) {
    return SoundEngineControl::shared().extendTimer(seconds);
}

void SoundEngineModule::setVolume(jsi::Runtime &, double volume) {
    SoundEngineControl::shared().setVolume(volume);
}

} // namespace facebook::react
