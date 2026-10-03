import { lstatSync, realpathSync } from "node:fs";
import type { PathProbe } from "./grants.js";

/** The real file system for canonicalFolder: native realpath (follows junctions), lstat that doesn't follow links. */
export const nodeFsProbe: PathProbe = {
  realpath: (path) => realpathSync.native(path),
  exists: (path) => lstatSync(path, { throwIfNoEntry: false }) !== undefined,
};
