#include "SoundEngineModule.h"
#include "SoundEngineControl.h"

#include <DefaultComponentsRegistry.h>
#include <DefaultTurboModuleManagerDelegate.h>
#include <FBReactNativeSpec.h>
#include <aaudio/AAudio.h>
#include <autolinking.h>
#include <fbjni/fbjni.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <stdexcept>
#include <thread>

namespace facebook::react {
namespace {

JavaVM *javaVM = nullptr;
jclass audioService = nullptr;
jmethodID prepareTransportMethod = nullptr;

void prepareTransport(bool playing) {
    JNIEnv *env = nullptr;
    const auto status = javaVM->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6);
    const bool attached = status == JNI_EDETACHED &&
        javaVM->AttachCurrentThread(&env, nullptr) == JNI_OK;
    if ((status != JNI_OK && !attached) || !audioService || !prepareTransportMethod) {
        if (attached) {
            javaVM->DetachCurrentThread();
        }
        throw std::runtime_error("Системное управление звуком недоступно");
    }
    const bool granted = env->CallStaticBooleanMethod(audioService, prepareTransportMethod, static_cast<jboolean>(playing));
    const bool failed = env->ExceptionCheck();
    if (failed) {
        env->ExceptionClear();
    }
    if (attached) {
        javaVM->DetachCurrentThread();
    }
    if (failed || !granted) {
        throw std::runtime_error("Android не предоставил аудиофокус");
    }
}

class AudioOutput {
public:
    void start() {
        routeMonitor_ = std::thread([this] { monitorRoute(); });
    }

    ~AudioOutput() {
        stopped_ = true;
        if (routeMonitor_.joinable()) {
            routeMonitor_.join();
        }
        closeStream();
        if (engine_) {
            SoundEngineControl::shared().attach(nullptr);
            sound_engine_destroy(engine_);
        }
    }

private:
    void openStream() {
        AAudioStreamBuilder *builder = nullptr;
        if (AAudio_createStreamBuilder(&builder) != AAUDIO_OK) {
            throw std::runtime_error("Не удалось создать аудиовывод");
        }
        AAudioStreamBuilder_setDirection(builder, AAUDIO_DIRECTION_OUTPUT);
        AAudioStreamBuilder_setFormat(builder, AAUDIO_FORMAT_PCM_FLOAT);
        AAudioStreamBuilder_setChannelCount(builder, 2);
        if (sampleRate_ > 0) {
            AAudioStreamBuilder_setSampleRate(builder, sampleRate_);
        }
        AAudioStreamBuilder_setDataCallback(builder, render, this);
        AAudioStreamBuilder_setErrorCallback(builder, handleStreamError, this);
        const auto result = AAudioStreamBuilder_openStream(builder, &stream_);
        AAudioStreamBuilder_delete(builder);
        if (result != AAUDIO_OK ||
            AAudioStream_getFormat(stream_) != AAUDIO_FORMAT_PCM_FLOAT ||
            AAudioStream_getChannelCount(stream_) != 2) {
            throw std::runtime_error("Не удалось открыть стереовывод");
        }
    }

    void closeStream() {
        if (stream_) {
            AAudioStream_close(stream_);
            stream_ = nullptr;
        }
    }

    void monitorRoute() {
        auto &control = SoundEngineControl::shared();
        while (!stopped_) {
            if (!needsRestart_.exchange(false)) {
                std::this_thread::sleep_for(std::chrono::milliseconds(200));
                continue;
            }
            control.setOutputAvailable(false);
            if (stream_) {
                try {
                    control.setPlaying(false);
                } catch (...) {
                    // Очередь может быть заполнена, пока аудиоустройство недоступно.
                }
            }
            closeStream();
            const bool isInitialStart = !engine_;
            try {
                openStream();
                if (isInitialStart) {
                    sampleRate_ = AAudioStream_getSampleRate(stream_);
                    engine_ = sound_engine_create(static_cast<float>(sampleRate_));
                }
                if (!engine_ || AAudioStream_getSampleRate(stream_) != sampleRate_ ||
                    AAudioStream_requestStart(stream_) != AAUDIO_OK) {
                    throw std::runtime_error("Не удалось восстановить аудиовывод");
                }
                if (isInitialStart) {
                    control.attach(engine_);
                } else {
                    control.setOutputAvailable(true);
                }
            } catch (...) {
                closeStream();
                if (isInitialStart) {
                    sound_engine_destroy(engine_);
                    engine_ = nullptr;
                    sampleRate_ = 0;
                }
                needsRestart_ = true;
                std::this_thread::sleep_for(std::chrono::milliseconds(500));
            }
        }
    }

    static void handleStreamError(AAudioStream *, void *context, aaudio_result_t) {
        static_cast<AudioOutput *>(context)->needsRestart_ = true;
    }

    static aaudio_data_callback_result_t render(AAudioStream *, void *context, void *audio, int32_t frames) {
        auto &output = *static_cast<AudioOutput *>(context);
        auto *samples = static_cast<float *>(audio);
        while (frames > 0) {
            const auto count = std::min(frames, static_cast<int32_t>(output.left_.size()));
            sound_engine_render(output.engine_, output.left_.data(), output.right_.data(), count);
            for (int32_t frame = 0; frame < count; ++frame) {
                *samples++ = output.left_[frame];
                *samples++ = output.right_[frame];
            }
            frames -= count;
        }
        return AAUDIO_CALLBACK_RESULT_CONTINUE;
    }

    AAudioStream *stream_ = nullptr;
    SoundEngine *engine_ = nullptr;
    int32_t sampleRate_ = 0;
    std::atomic_bool stopped_{false};
    std::atomic_bool needsRestart_{true};
    std::thread routeMonitor_;
    std::array<float, 256> left_{};
    std::array<float, 256> right_{};
};

std::shared_ptr<TurboModule> getCxxModule(
    const std::string &name, const std::shared_ptr<CallInvoker> &invoker) {
    if (name == SoundEngineModule::kModuleName) {
        static const auto output = [] {
            // Управляющая сторона должна пережить уничтожение аудиовывода.
            SoundEngineControl::shared();
            auto instance = std::make_unique<AudioOutput>();
            try {
                instance->start();
            } catch (const std::runtime_error &) {
                return std::unique_ptr<AudioOutput>{};
            }
            return instance;
        }();
        (void)output;
        return std::make_shared<SoundEngineModule>(invoker, prepareTransport);
    }
    return autolinking_cxxModuleProvider(name, invoker);
}

std::shared_ptr<TurboModule> getJavaModule(const std::string &name, const JavaTurboModule::InitParams &params) {
    if (auto module = FBReactNativeSpec_ModuleProvider(name, params)) {
        return module;
    }
    return autolinking_ModuleProvider(name, params);
}

} // namespace
} // namespace facebook::react

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *) {
  return facebook::jni::initialize(vm, [vm] {
        using namespace facebook::react;
        javaVM = vm;
        auto *env = facebook::jni::Environment::current();
        auto service = env->FindClass("com/cuddlelamp/PlaybackService");
        audioService = static_cast<jclass>(env->NewGlobalRef(service));
        env->DeleteLocalRef(service);
        prepareTransportMethod = env->GetStaticMethodID(audioService, "prepareTransport", "(Z)Z");
        DefaultTurboModuleManagerDelegate::cxxModuleProvider = getCxxModule;
        DefaultTurboModuleManagerDelegate::javaModuleProvider = getJavaModule;
        DefaultComponentsRegistry::registerComponentDescriptorsFromEntryPoint = autolinking_registerProviders;
    });
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_cuddlelamp_PlaybackService_setNativePlaying(JNIEnv *, jclass, jboolean playing) {
    try {
        facebook::react::SoundEngineControl::shared().setPlaying(playing);
        return JNI_TRUE;
    } catch (...) {
        return JNI_FALSE;
    }
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_cuddlelamp_PlaybackService_readNativeSnapshot(JNIEnv *, jclass) {
    try {
        const auto snapshot = facebook::react::SoundEngineControl::shared().readSnapshot();
        // JSON передаётся как UTF-8, включая идентификаторы сцен.
        return facebook::jni::make_jstring(snapshot).release();
    } catch (...) {
        return nullptr;
    }
}
