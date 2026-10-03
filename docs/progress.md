# Progress

The handoff note between Claude Code sessions. Read it first; update it last
(`/handoff`). Keep it under ~60 lines: current state, not history.

## Current state

- Context and tooling set up: CLAUDE.md, rules, six skills, boundary reviewer,
  hooks, empty pnpm workspace with five packages.
- No application code yet.

## Next

**Milestone 1: process skeleton.** Run `/milestone 1`.
Done when: the UI sends a message to the agent and gets a reply, and the agent
has no way to touch the filesystem.

## Done

| Milestone | Date | Notes |
| --- | --- | --- |
| 0 Setup | 2026-10-03 | Context, skills, guardrails, workspace skeleton |

## Open questions

- Model provider and model for the agent loop (decide in milestone 3; record an ADR).
- Speech-to-text provider (decide in milestone 6).
- Trademark check for the name "Totum".
