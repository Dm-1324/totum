// Template for a Totum capability implementation in packages/host.
// Copy to packages/host/src/capabilities/<id>.ts and fill in every TODO.
// Adjust imports to the real paths once milestone 2 has created them.

import type { Capability, RunContext, Result, AuditEntry, Scope } from "@totum/shared";
import { ExampleInput, type ExampleInputT, type ExampleOutputT, exampleSpec } from "@totum/shared";

export const example: Capability<ExampleInputT, ExampleOutputT> = {
  // id, tier, description and input schema come from the shared spec so the
  // model, the permission engine and the UI all see the same definition.
  ...exampleSpec,
  input: ExampleInput,

  scopeOf(input): Scope {
    // TODO: the exact folder / app / account this call touches.
    return { kind: "folder", path: input.path };
  },

  describe(input): string {
    // TODO: plain words for the approval dialog. Include the exact
    // command / path / recipient / sending account.
    return `Do the example thing to ${input.path}`;
  },

  async run(input, ctx: RunContext): Promise<Result<ExampleOutputT>> {
    try {
      // TODO: do the work. Use ctx for cancellation (ctx.signal) and logging.
      const output: ExampleOutputT = { /* ... */ } as ExampleOutputT;
      // untrusted: true if any part of the output came from outside
      // (file contents, command output, web text, email).
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
  async undo(record: AuditEntry): Promise<void> {
    // TODO: restore the state captured before run (e.g. the backup file).
    // Refuse if the current state no longer matches what run produced.
  },
};
