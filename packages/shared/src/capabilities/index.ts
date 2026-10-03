import type { CapabilitySpec } from "../capability.js";
import { testDangerSpec, testEchoSpec, testNoteSpec, testSendSpec } from "./test.js";

export * from "./test.js";

/**
 * Test capability specs (milestone 2). Only dev and test builds may use them:
 * reference this list solely behind `__TOTUM_DEV__` at a process entry point,
 * so production bundles tree-shake it away (checked by production-build.test.ts).
 */
export const TEST_CAPABILITY_SPECS: ReadonlyArray<CapabilitySpec<unknown, unknown>> = [
  testEchoSpec,
  testNoteSpec,
  testDangerSpec,
  testSendSpec,
];
