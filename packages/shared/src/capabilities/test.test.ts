import { describe, expect, it } from "vitest";
import { CapabilityId } from "../capability.js";
import { TEST_CAPABILITY_SPECS, testDangerSpec, testEchoSpec, testNoteSpec, testSendSpec } from "./index.js";

describe("test capability specs", () => {
  it("cover one capability per tier, with valid unique ids", () => {
    expect(TEST_CAPABILITY_SPECS.map((s) => s.tier)).toEqual([0, 1, 2, 3]);
    const ids = TEST_CAPABILITY_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(CapabilityId.safeParse(id).success, id).toBe(true);
      expect(id.startsWith("test."), id).toBe(true);
    }
  });

  it("keep descriptions under 400 characters, with an example input that parses", () => {
    for (const spec of TEST_CAPABILITY_SPECS) {
      expect(spec.description.length, spec.id).toBeLessThan(400);
      const example = /Example input: (\{.*\})$/.exec(spec.description)?.[1];
      expect(example, spec.id).toBeDefined();
      expect(spec.input.safeParse(JSON.parse(example!)).success, spec.id).toBe(true);
    }
  });

  it("reject unknown input fields", () => {
    expect(testEchoSpec.input.safeParse({ text: "hi", extra: 1 }).success).toBe(false);
    expect(testNoteSpec.input.safeParse({ text: "hi", path: "C:\\" }).success).toBe(false);
    expect(testDangerSpec.input.safeParse({ all: true }).success).toBe(false);
    expect(testSendSpec.input.safeParse({ to: "a@b.c", body: "hi", cc: "x@y.z" }).success).toBe(false);
  });

  it("reject bad input values", () => {
    expect(testEchoSpec.input.safeParse({ text: "" }).success).toBe(false);
    expect(testNoteSpec.input.safeParse({ text: 42 }).success).toBe(false);
    for (const to of ["", "nobody", "a b@c.d", "@x", "a@"]) {
      expect(testSendSpec.input.safeParse({ to, body: "hi" }).success, to).toBe(false);
    }
  });

  it("check outputs too", () => {
    expect(testNoteSpec.output.safeParse({ noteId: 3 }).success).toBe(true);
    expect(testNoteSpec.output.safeParse({ noteId: 0 }).success).toBe(false);
    expect(testDangerSpec.output.safeParse({ cleared: -1 }).success).toBe(false);
    expect(testSendSpec.output.safeParse({ queued: false }).success).toBe(false);
  });
});
