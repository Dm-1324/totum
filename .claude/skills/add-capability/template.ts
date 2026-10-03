// Template for a Totum capability implementation in packages/host.
// Copy to packages/host/src/capabilities/<id>.ts and fill in every TODO.
// Contract: packages/shared/src/capability.ts (ADR 0005).

import type { Capability, RunContext, Result, Scope, UndoRecord } from "@totum/shared";
import { type ExampleInput, type ExampleOutput, exampleSpec } from "@totum/shared";

export const example: Capability<ExampleInput, ExampleOutput> = {
  // id, tier, description and the input/output schemas come from the shared
  // spec so the model, the permission engine and the UI see the same definition.
  ...exampleSpec,

  scopeOf(input): Scope {
    // TODO: the exact folder / app / account this call touches.
    return { kind: "folder", path: input.path };
  },

  describe(input): string {
    // TODO: plain words for the approval dialog. Include the exact
    // command / path / recipient / sending account.
    return `Do the example thing to ${input.path}`;
  },

  async run(input, ctx: RunContext): Promise<Result<ExampleOutput>> {
    try {
      // TODO: do the work. Use ctx for cancellation (ctx.signal) and logging.
      const output: ExampleOutput = { /* ... */ } as ExampleOutput;
      // untrusted: true if any part of the output came from outside
      // (file contents, command output, web text, email).
      // Tier 1: also return `undo`, a small JSON token your undo() needs.
      return { ok: true, output, untrusted: true };
    } catch (err) {
      return {
        ok: false,
        code: "example_failed", // TODO: a specific, stable code
        message: err instanceof Error ? err.message : String(err),
        hint: "TODO: what the model should try next",
      };
    }
  },

  async verify(input, output): Promise<boolean> {
    // TODO: confirm the effect through the same route it acted on.
    return true;
  },

  // Required for tier 1; delete for tiers 0, 2 and 3.
  async undo(record: UndoRecord, ctx: RunContext): Promise<Result<null>> {
    // TODO: restore the state captured before run, using record.token.
    // Refuse (ok: false, e.g. code "changed_since") if the current state no
    // longer matches what run produced.
    return { ok: true, output: null, untrusted: false };
  },

  // Optional: strip secrets before the input goes into the audit log.
  // redact(input) { return { ...input, token: "[redacted]" }; },
};
