---
name: milestone
description: Start a Totum build milestone. Reads progress, plans the milestone in plan mode, saves the plan to docs/plans, and waits for approval before any code.
argument-hint: "[milestone-number]"
disable-model-invocation: true
---

# Start milestone $ARGUMENTS

You are starting milestone **$ARGUMENTS** of the Totum Stage 1 build.

## 1. Load context (read, don't skim)

1. `docs/progress.md`: current state, open questions, anything left from last session.
2. `docs/architecture.md`: find milestone $ARGUMENTS in the build-order table.
   Copy its **done-when** line word for word; it is the definition of done.
3. `docs/capabilities.md` if the milestone adds capabilities.
4. Any earlier plans in `docs/plans/` this milestone builds on.
5. Look at the actual code in the packages the milestone touches. Don't plan from memory.

If progress.md says the previous milestone is not closed, stop and tell the user.

## 2. Plan (plan mode; no code yet)

Enter plan mode and write `docs/plans/m$ARGUMENTS.md` with exactly these sections:

```markdown
# Milestone $ARGUMENTS: <name>

## Done when
<copied verbatim from docs/architecture.md>

## How we'll prove it
<the concrete check: a test name, a command, or steps in the running app>

## Slices
<3-8 numbered slices. Each: what changes, which packages, which tests.
Each slice must leave typecheck + tests green and be one commit.>

## Boundary check
<for every new import / IPC message / capability: which process owns it and
why that respects the one rule in CLAUDE.md>

## Decisions needed
<library or approach choices -> each becomes an ADR (adr skill). Ask the user
about any the plan docs leave open.>

## Out of scope
<things that look related but belong to a later milestone>
```

Keep it short: a plan the user can review in two minutes.

## 3. Stop and wait

Show the plan and ask the user to approve or change it. Do not write code until
they approve. After approval, work slice by slice; tick each slice in the plan
file as it lands.
