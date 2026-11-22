#!/bin/bash
set -euo pipefail

usage() {
    cat <<-EOF
Описание:
  Собирает ядро (крейт sound-ffi) в release под iOS-устройство и arm64-симулятор
  и упаковывает обе статические библиотеки с заголовком sound_engine.h
  в core/target/ios/SoundEngine.xcframework.

Параметры:
  -h  — показать эту справку (опционально)

Использование:
  npm run core:ios
  bash scripts/build-core-ios.sh
EOF
    exit 1
}

# Константы
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_DIR="${REPO_DIR}/core"
HEADERS_DIR="${CORE_DIR}/crates/sound-ffi/include"
LIBRARY_NAME="libsound_engine.a"
DEVICE_TARGET="aarch64-apple-ios"
SIMULATOR_TARGET="aarch64-apple-ios-sim"
OUTPUT_DIR="${CORE_DIR}/target/ios"
XCFRAMEWORK_PATH="${OUTPUT_DIR}/SoundEngine.xcframework"

while getopts "h" option; do
    case "${option}" in
    h) usage ;;
    *) usage ;;
    esac
done

for tool in cargo rustup xcodebuild; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
        echo "Не найдена утилита ${tool}" >&2
        exit 1
    fi
done

INSTALLED_TARGETS="$(rustup target list --installed)"
for target in "${DEVICE_TARGET}" "${SIMULATOR_TARGET}"; do
    if ! grep -qx "${target}" <<<"${INSTALLED_TARGETS}"; then
        echo "Не установлен Rust-таргет ${target}, поставь его командой: rustup target add ${target}" >&2
        exit 1
    fi
done

echo "Собираем ядро под ${DEVICE_TARGET} и ${SIMULATOR_TARGET}"
cargo build \
    --manifest-path "${CORE_DIR}/Cargo.toml" \
    --package sound-ffi \
    --release \
    --target "${DEVICE_TARGET}" \
    --target "${SIMULATOR_TARGET}"

# xcodebuild не перезаписывает существующий xcframework, поэтому старую сборку удаляем
rm -rf "${XCFRAMEWORK_PATH}"
mkdir -p "${OUTPUT_DIR}"

echo "Упаковываем в ${XCFRAMEWORK_PATH#"${REPO_DIR}/"}"
xcodebuild -create-xcframework \
    -library "${CORE_DIR}/target/${DEVICE_TARGET}/release/${LIBRARY_NAME}" -headers "${HEADERS_DIR}" \
    -library "${CORE_DIR}/target/${SIMULATOR_TARGET}/release/${LIBRARY_NAME}" -headers "${HEADERS_DIR}" \
    -output "${XCFRAMEWORK_PATH}" >/dev/null

echo "Готово, $(du -sh "${XCFRAMEWORK_PATH}" | awk '{print $1}')"
