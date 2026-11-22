#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! rustup target list --installed | grep -qx wasm32-unknown-unknown; then
    printf '%s\n' 'Для студии нужна цель Rust wasm32-unknown-unknown.' \
        'Установите её командой: rustup target add wasm32-unknown-unknown' >&2
    exit 1
fi

cargo build --manifest-path core/Cargo.toml --locked --release --target wasm32-unknown-unknown \
    --target-dir core/target --package sound-web

mkdir -p studio/public
cp core/target/wasm32-unknown-unknown/release/sound_web.wasm studio/public/
