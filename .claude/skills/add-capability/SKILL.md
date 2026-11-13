---
name: add-capability
description: Add or change a Totum capability (anything that reads or acts on the user's machine, such as files.read or shell.execute). Use whenever a capability is created, modified, or its tier changes.
paths:
  - "packages/host/**"
  - "packages/shared/**"
---

# Add or change a capability

A capability is the only way Totum touches the machine. Get every step right;
the safety model depends on it.

## 1. Pick the tier

Read [tier-guide.md](tier-guide.md). State the tier and the one-sentence reason
before writing code. If unsure between two tiers, pick the higher one and ask.

## 2. Define it in `packages/shared`

- `src/capabilities/<area>.ts`: input and output zod schemas, the `id`
  (`area.verb`, e.g. `files.search`), `tier`, and the `description` the model
  will read. Write the description for the model: what it does, when to use it,
  what it returns, one example input. Under 400 characters.
- Export it from the shared capability registry.

## 3. Implement it in `packages/host`

Copy [template.ts](template.ts) to `packages/host/src/capabilities/<id>.ts` and
fill it in. Requirements:

- `scopeOf(input)` returns the exact folder / app / account touched.
- `describe(input)` is plain words for the approval dialog, including the exact
  command, path, recipient or sending account.
- `run` sets `untrusted: true` on any output that came from outside
  (file contents, command output, web text, email).
- `verify` checks the effect through the same route (file exists, exit code 0).
- Tier 1 must implement `undo`. Writes back up the old content first.
- Errors return `{ ok: false, code, message, hint }`; the hint tells the model
  what to try next.
- Register it with the host's capability registry. Never export `run` for direct use.

## 4. Test it (`<id>.test.ts` next to the implementation)

Required tests, all through the host's public call path, not `run` directly:

1. Without a grant, the engine asks the user (it does not fail at once). Denying
   fails the call with `not_granted` and a hint; the denial is remembered for
   that task. Granting runs it. `always` is offered only for tier 0/1, and never
   when the step was shaped by untrusted content.
2. With a grant for a different scope, it asks again (exact scope, never a
   broader one). Folder scopes: links and junctions resolve before the check.
3. Tier 2/3: the call blocks until approval; rejecting means nothing runs.
4. The audit log gets an entry with capability, scope, inputs (secrets redacted),
   result and approver.
5. Tier 1: `undo` restores the previous state.
6. Happy path, including `verify`.

If the output can contain outside text, also use the `injection-test` skill.

## 5. Update the registry doc

Add or update the row in `docs/capabilities.md` (id, tier, milestone, status).

## 6. Finish

Run `pnpm --filter @totum/host test` and `pnpm --filter @totum/shared typecheck`.
