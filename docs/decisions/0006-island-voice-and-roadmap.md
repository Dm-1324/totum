# 0006: Island interface, local always-on voice, new milestone order

- Date: 2026-11-13
- Status: accepted
- Milestone: 2 (planning between slices 6 and 7)

## Context
Totum's interface was planned as a normal window with a command bar. The builder wants
an always-present assistant (like Dynamic Island) that listens and sees, and wants
to finish Stage 1 quickly with a limited usage budget.

## Decision
- The UI becomes an **island** at the top centre with an eyes "personality"
  (docs/island.md; design in the Totum Island Claude Design canvas). It moves up to M4.
- **Always listening** means a local wake word ("Hey Totum", or a user-recorded phrase,
  or a double clap); audio leaves the laptop only as transcribed command text.
- **Always seeing** means context on call now; opt-in encrypted screen memory later (M10).
- Voice builds on sherpa-onnx and reuses OpenWhispr code; dictation into any app is a
  user action in main, never an agent capability (docs/toolkit.md).
- New milestone order and model-per-task guide in docs/build-plan.md.

## Alternatives considered
- Cloud speech for always-on listening: rejected (privacy, cost).
- openWakeWord: rejected (non-commercial pretrained models).
- Continuous screen recording sent to the model: rejected (cost, privacy).

## Consequences
packages/ui is rebuilt as the island in M4; slice 5's dialog, log and grants move into
the expanded views. Host gains audio capabilities in M7. No change to the permission
engine, audit log or the one rule.
