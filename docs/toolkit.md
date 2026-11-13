# Open-source toolkit

Decided 2026-11-13. Before writing a feature from scratch, check this list.
Every pick: spike first (prove it works in Electron on Windows), one ADR per
dependency, native/audio code in `host` only, pin exact versions, add to the lint
allow-list on purpose, copied code keeps its licence header and is listed in
`THIRD_PARTY_NOTICES.md`. Models download on first use, hash-checked, into app data.

Licences: MIT, Apache-2.0, BSD, Unlicense are fine. GPL, non-commercial or
source-available need an ADR (default: no).

| Need | Pick | Licence | Milestone |
| --- | --- | --- | --- |
| Dictation into any app (Wispr Flow-like) | OpenWhispr (reuse code: same Electron/React/TS stack) https://github.com/OpenWhispr/openwhispr ; Handy (Rust, reference for VAD + reliable paste) https://github.com/cjpais/Handy | MIT | 7 |
| Speech to text (local) | sherpa-onnx https://github.com/k2-fsa/sherpa-onnx with NVIDIA Parakeet; whisper.cpp for other languages (Hindi) | Apache-2.0 / MIT | 7 |
| Voice activity detection | Silero VAD via sherpa-onnx | MIT | 7 |
| Wake word incl. custom phrase | sherpa-onnx keyword spotting (open vocabulary, phrase as text, no training) | Apache-2.0 | 7 |
| Double-clap wake | own onset detector (two sharp peaks) | n/a | 7 |
| Text to speech | Kokoro-82M via sherpa-onnx | Apache-2.0 | 7 |
| Model client in the agent | @anthropic-ai/sdk (fetch-based; works in the sandboxed agent) | MIT | 3 |
| File search | ripgrep / fd + Windows Search index | MIT / Unlicense; built-in | 5 |
| Active window screenshot | Electron desktopCapturer | built-in | 5 |
| OCR | Windows.Media.Ocr | built-in | 5, 10 |
| Native app controls | FlaUI in a small .NET helper run by host | MIT | Stage 3 |
| Desktop agent patterns | Microsoft UFO (reference only) | MIT | Stage 3 |
| Gmail / Outlook | googleapis, @azure/msal-node, Microsoft Graph client | Apache-2.0 / MIT | 8 |
| Screen memory | own build on Windows OCR + SQLite FTS; screenpipe as design reference | n/a | 10 |

## Licence traps (reference only, never a dependency)

| Project | Trap | Instead |
| --- | --- | --- |
| screenpipe | source-available; commercial use needs a paid licence | own build |
| openWakeWord | pretrained models are non-commercial | sherpa-onnx KWS |
| Piper TTS | maintained version is GPL | Kokoro |
| nut.js | element inspection and prebuilt packages are paid | FlaUI |

## Voice pipeline (M7)

Mic (always open) -> Silero VAD + keyword spotter (local) -> recorder until silence ->
speech to text (local) -> either
- dictation key: paste at cursor. The user's own words, done in main, no approval.
  The agent can never trigger this; agent typing into apps stays a tier-2 capability.
- command / wake word: agent (permissions apply) -> model API (text only leaves the
  laptop) -> spoken reply (Kokoro).
