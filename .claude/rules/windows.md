# Windows development rules

Totum is built and run on Windows.

- Build paths with `path.join` / `path.resolve`; never hard-code `/` or `\`.
  Compare paths case-insensitively when checking grants and scopes.
- Shell commands in scripts and docs should work in PowerShell. Avoid bash-only
  syntax (`&&` chains are fine in PowerShell 7, `$(...)` is not portable).
- Line endings: the repo stores LF (`.gitattributes`); don't fight it.
- User folders: resolve via `app.getPath('documents' | 'downloads' | 'home')`
  in host, never by string-building `C:\Users\...`.
- Native modules (e.g. better-sqlite3) need `electron-rebuild` / prebuilt
  binaries for Electron's Node ABI; note this in the ADR when adding one.
