cmake_minimum_required(VERSION 3.13)
project(appmodules)

include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

get_filename_component(REPO_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../.." ABSOLUTE)
set(RUST_LIBRARY "${REPO_DIR}/core/target/android/${ANDROID_ABI}/libsound_engine.a")
if(NOT EXISTS "${RUST_LIBRARY}")
    message(FATAL_ERROR "Нет библиотеки ядра для ${ANDROID_ABI}. Выполните npm run core:android из корня проекта.")
endif()
add_library(sound_engine STATIC IMPORTED)
set_target_properties(sound_engine PROPERTIES IMPORTED_LOCATION "${RUST_LIBRARY}")

target_sources(appmodules PRIVATE
    "${REPO_DIR}/cpp/SoundEngineControl.cpp"
    "${REPO_DIR}/cpp/SoundEngineModule.cpp")
target_include_directories(appmodules PRIVATE
    "${REPO_DIR}/cpp"
    "${REPO_DIR}/core/crates/sound-ffi/include")
target_link_libraries(appmodules sound_engine common_flags aaudio log dl m)
