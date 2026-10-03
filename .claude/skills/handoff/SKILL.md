---
name: handoff
description: End a Totum session. Verifies green, checks the milestone's done-when, updates docs/progress.md for the next cold-start session, and proposes a commit.
disable-model-invocation: true
---

# Hand off this session

The next session starts with no memory of this one. `docs/progress.md` is the
only thing it will read. Make it accurate.

## 1. Verify

Run, from the repo root:

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm lint`

If any fail, report the failure to the user and ask whether to fix now or hand
off with it recorded as a known issue. Never claim green when it isn't.

## 2. Check done-when

Open `docs/plans/m<N>.md`. Is its done-when actually demonstrated (test passing,
or the user confirmed it in the running app)? Answer yes or no, with the evidence.
If yes and the boundary-reviewer has not run on this milestone's diff, run it now.

## 3. Update `docs/progress.md`

Rewrite (don't append to) these sections:

- **Current state**: what works now, in 3-6 bullets. Facts only.
- **Next**: the next milestone or remaining slices, with its done-when line.
- **Done**: add a row if a milestone closed (number, date, one-line note).
- **Open questions**: add new ones, remove resolved ones.
- **Known issues** (add the section if needed): anything failing or fragile,
  with the file and the symptom.

Keep the file under ~60 lines. Detail belongs in plans and ADRs, not here.

Also tick finished slices in `docs/plans/m<N>.md`, and update
`docs/capabilities.md` statuses if capabilities landed.

## 4. Context hygiene

If during this session the user corrected the same thing twice, propose a
one-line addition to `CLAUDE.md` or the matching `.claude/rules/*.md` file.

## 5. Commit

Show `git status` and propose a commit message:
`m<N>: <what changed>` plus a short body. Ask before committing.

Finish by telling the user: what's done, what's next, and to run `/clear`
before starting the next milestone.
