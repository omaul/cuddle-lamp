#pragma once

#if __has_include(<ReactCodegen/CuddleLampSpecsJSI.h>)
#include <ReactCodegen/CuddleLampSpecsJSI.h>
#else
#include <CuddleLampSpecsJSI.h>
#endif

#include <memory>
#include <functional>
#include <string>

namespace facebook::react {

class SoundEngineModule final : public NativeSoundEngineCxxSpec<SoundEngineModule> {
public:
    explicit SoundEngineModule(std::shared_ptr<CallInvoker> invoker, std::function<void(bool)> prepareTransport = {});
    std::string readSnapshot(jsi::Runtime &runtime);
    double loadScene(jsi::Runtime &runtime, const std::string &json);
    double setPlaying(jsi::Runtime &runtime, bool playing);
    double setKnob(jsi::Runtime &runtime, const std::string &sceneId, const std::string &id, double value);
    double setTimer(jsi::Runtime &runtime, double seconds);
    void setVolume(jsi::Runtime &runtime, double volume);

private:
    std::function<void(bool)> prepareTransport_;
};

} // namespace facebook::react
