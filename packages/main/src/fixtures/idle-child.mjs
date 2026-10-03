// Test fixture: a child that never exits on its own and ignores SIGTERM.
process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
