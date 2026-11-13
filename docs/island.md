# Totum Island

Decided 2026-11-13. Design: "Totum Island" canvas in Claude Design (states, approval,
open view, live prototype, eyes component). Build milestone 4 from that design.

## What it is

A small black pill at the **top centre** of the screen with two eyes. It replaces the
normal window. It grows only as much as each moment needs; clicks pass through the
empty area around it. Hidden over full-screen apps; follows the monitor with the cursor.

## States (eyes tell you what Totum is doing)

| State | Eyes | Island |
| --- | --- | --- |
| Resting | half-closed, slow random blink (4-6 s) | small pill |
| Listening | wide, teal glow | teal voice-level bars |
| Thinking | white; the eyes ARE the loader: squeeze shut one after the other. No spinner, no dots | small pill |
| Acting | look toward the text, as if reading along | widens to show the current step, e.g. "Rerunning the build 2/4" |
| Asking you | amber, no blink | expands: what will run, exact scope, Reject (focused) / Approve; Enter and Esc reject |
| Approved | flash green ~0.8 s | then Acting |
| Speaking | white, blinking | white voice-level bars |
| Done | happy closed arcs | one-line result, then back to rest |
| Muted | closed (thin lines) | mic-off icon |
| Open (click the island) | larger face with a smile, eyes follow cursor | left: face + greeting; right: recent tasks (amber row + Review for anything needing you); bottom right: message box + mic |

Colour rules: amber = needs you, green = you said yes. Nothing else uses those colours.
Eyes glance toward the cursor when it nears the top of the screen.

## Always listening

The microphone is open all the time, but only a **local** wake-word model hears it.
Audio goes to speech-to-text only after the wake word. Push-to-talk and clicking still work.
Mute hotkey; eyes closed when muted. Windows' own mic indicator stays visible.

- Default wake word: "Hey Totum".
- Custom: the user records their own phrase (5-10 recordings in setup; transcribed locally
  and added as a keyword, no training) or chooses a sound such as a double clap.
- A wake phrase is a trigger, not a password: approvals still guard every risky step.

## Always seeing

- **Context on call (now, M5):** when called, capture active app, window title, focused
  text, and a screenshot only if layout matters. All untrusted.
- **Screen memory (later, optional M10, off by default):** local OCR history. Must be
  encrypted (unlocked by Windows Hello), never synced, exclude password managers /
  banking / private windows / user-chosen apps, retention limit (e.g. 7 days),
  "forget the last hour". Everything read from screen is untrusted (taint rule applies).

## Conversation mode (M7)

- Follow-up window: after speaking, listens ~8 s without the wake word.
- Barge-in: talking over Totum stops it (needs echo cancellation; Chromium's mic AEC).
- Streams speech sentence by sentence while the model writes.
- Conversation keeps context until "that's all" or a few quiet minutes; taint resets then.
- Pure chat uses no capabilities, so no approvals; actions follow the normal rules.

## Later

Sound effects for wake, approval needed, approved, done: quiet, off by default,
original or CC0 sounds (M9).
