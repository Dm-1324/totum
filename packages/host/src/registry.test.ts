import { describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { productionCapabilities } from "./registry.js";

describe("productionCapabilities", () => {
  it("contains no test capabilities", () => {
    const ids = productionCapabilities(openDb(":memory:")).map((c) => c.id);
    expect(ids.filter((id) => id.startsWith("test."))).toEqual([]);
  });
});
