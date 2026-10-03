// The capabilities every build ships. Milestone 4 adds the first real ones.
// Test capabilities are not here: index.ts adds them behind __TOTUM_DEV__ so
// production bundles never contain them (production-build.test.ts).
import type { Db } from "./db.js";
import type { AnyCapability } from "./engine.js";

export function productionCapabilities(_db: Db): AnyCapability[] {
  return [];
}
