# Progress

The handoff note between Claude Code sessions. Read it first; update it last
(`/handoff`). Keep it under ~60 lines: current state, not history.

## Current state

- Milestone 1 closed. `pnpm dev` opens the React UI; a message goes ui -> preload
  -> main -> agent -> back ("agent: hello"). `chat.send` always answers: reply,
  `agent_timeout` (10 s), `agent_unavailable`, `invalid_request` or `untrusted_sender`.
- Agent runs in a hidden sandboxed renderer (ADR 0004): no Node, CSP
  `connect-src 'none'; worker-src 'none'`, own session blocking all but its two
  files, MessagePort-only preload. Proven in real Electron by
  `packages/main/src/agent-sandbox.test.ts`.
- Host is a utility process that announces `host.ready` and rejects all messages.
- main supervises both: restart with backoff, gives up after 3 crashes in 60 s,
  clean stop on quit. Replies matched by id; unknown/duplicate/late ones dropped.
- `pnpm lint`: dependency-cruiser allow-lists for agent, ui and shared (closes
  indirect paths), plus `scripts/check-no-raw-html.mjs` for packages/ui.
- 182 tests green. Boundary-reviewer on the milestone 1 diff: PASS (third pass).

## Next

**Milestone 2: permission spine.** Run `/milestone 2`.
Done when: a tier-2 call blocks until approved; every call appears in the log.
Notes for it: host gets its first messages (capability requests), SQLite arrives
(native module: rebuild for Electron's ABI, record in the ADR), and approval
dialogs go host -> main -> ui. The UI session denies every permission today.

## Done

| Milestone | Date | Notes |
| --- | --- | --- |
| 0 Setup | 2026-10-03 | Context, skills, guardrails, workspace skeleton |
| 1 Process skeleton | 2026-10-03 | Typed IPC, supervised agent + host, agent in sandboxed renderer (ADRs 0002-0004) |

## Open questions

- Model provider and model for the agent loop (decide in milestone 3; record an ADR).
- Speech-to-text provider (decide in milestone 6).
- Trademark check for the name "Totum".

## Known issues and notes for later

- Milestone 3: main logs the agent's console output (`agent-window.ts`, console-message);
  Chromium's CSP warnings include the blocked URL, which may carry untrusted text.
  Trim or redact URLs before logging. Same milestone: allow only the model API host
  in both the agent CSP (`packages/agent/index.html`) and the session filter (`agent-request.ts`).
- Dev: `pnpm dev` builds the agent page and preload once at start; agent code
  changes need an app restart (no watch for `agent*.vite.config.ts`).
- electron-vite's preload `isolatedEntries` crashes when stdout isn't a TTY;
  that's why the agent preload has its own Vite build (ADR 0002).
- `agent-sandbox.test.ts` launches Electron and takes ~10 s; it needs a desktop
  session (hidden windows), so it may need care in CI.
