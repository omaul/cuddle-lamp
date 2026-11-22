#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sdk_dir="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-${sdk_dir:+${sdk_dir}/ndk/27.1.12297006}}"

if [[ -z "$ANDROID_NDK_HOME" || ! -d "$ANDROID_NDK_HOME" ]]; then
    echo "Укажите путь к Android NDK в ANDROID_NDK_HOME" >&2
    exit 1
fi

cd "$repo_dir/core"
cargo ndk -p 26 -t arm64-v8a -t armeabi-v7a -t x86 -t x86_64 build --release -p sound-ffi

targets=(aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android)
abis=(arm64-v8a armeabi-v7a x86 x86_64)
for index in "${!targets[@]}"; do
    output="target/android/${abis[index]}"
    mkdir -p "$output"
    cp "${CARGO_TARGET_DIR:-target}/${targets[index]}/release/libsound_engine.a" "$output/"
done
