# Build plan and model guide

Decided 2026-11-13. Order supersedes the build-order table's numbering in
architecture.md (which now points here).

## Which model for which task (Claude Code: /model, /effort)

Opus decides, Sonnet builds, Haiku fetches. Not Fable (too few prompts per window).

| Task | Model | Effort |
| --- | --- | --- |
| /milestone N planning (plan mode) | Opus | high |
| Slices in ui, main wiring, tests, docs | Sonnet | medium |
| Slices in host, permission engine, IPC schemas, anything untrusted | Opus | medium |
| A bug Sonnet failed twice | Opus | high |
| Boundary review at close (agent has model: opus) | Opus | high |
| Searching code, reading logs, running tests | Haiku | low |
| /handoff, commit messages | Sonnet | low |

## Each 5-hour window

1. Start (Opus, 1 turn): /milestone N or "continue at slice K".
2. Build (Sonnet): one slice per turn, green and committed.
3. Every 2-3 slices: /handoff then /clear.
4. Close (Opus): boundary review, /handoff.
No background security reviews. Last ~15% of a window: /handoff only.
Hit a limit mid-slice: fresh session, "Read docs/progress.md, finish slice K".

## Milestones (Stage 1)

| # | Milestone | Done when | Windows |
| --- | --- | --- | --- |
| 2 | Permission spine close-out (slice 7) | manual pnpm dev check passes; boundary review PASS | 1 |
| 3 | Agent loop | completes a three-step task with test capabilities using the real model | 3 |
| 4 | Island (from the Claude Design canvas, docs/island.md) | island replaces the window: all states, eyes follow cursor, approvals expand, open view with recent + message box, push-to-talk opens it | 3 |
| 5 | Files and context | "find the PDF I edited last week" returns the right file; context.active + screen.capture on call | 2 |
| 6 | Shell and wedge 1 | "why is this build failing?" right on three real projects | 2 |
| 7 | Voice (docs/toolkit.md) | "Hey Totum", custom phrase or clap wakes it; dictation into any app; conversation with spoken replies | 2 |
| 8 | Email and wedge 2 | "attach my resume to a draft for Rahul" leaves a correct draft (Gmail or Outlook) | 2 |
| 9 | Hardening | injection tests end in approval or refusal; crash resume; cost meter; DevTools off in production; sound effects | 2 |
| 10 | Screen memory (optional) | opt-in, encrypted, exclusions, "forget the last hour" | 2 |

## Models inside Totum (decide with an ADR at the start of M3)

Recommended: Claude API, billed separately from the Claude subscription (Console API key,
stored with DPAPI in host). Sonnet (claude-sonnet-5-5) for the agent loop; Haiku
(claude-haiku-4-5-20251001) for quick steps; Opus (claude-opus-5-5) only when asked to think
harder. Prompt caching for the fixed system prompt and capability list. Open question for
the M3 plan: the key belongs to host, so model calls may go through main instead of
holding the key in the agent window.
