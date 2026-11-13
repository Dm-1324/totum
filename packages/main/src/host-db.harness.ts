// Runs inside Electron for host-db.process.test.ts (not a test file itself).
// Forks the built host as a real utility process, makes one refused call so
// the host writes an audit row to its SQLite file, reads the rows back over
// the same port, and prints one JSON line.
import { hostDbArg, type HostToMain } from "@totum/shared";
import { app, utilityProcess } from "electron";

function arg(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`missing ${prefix}`);
  return value;
}

const hostPath = arg("host");
const dbPath = arg("db");

function run(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const host = utilityProcess.fork(hostPath, [hostDbArg(dbPath)], { serviceName: "host-db-test", stdio: "inherit" });
    const requestId = crypto.randomUUID();
    const queryId = crypto.randomUUID();
    const seen: string[] = [];
    let callResult: unknown;
    const fail = (why: string) => {
      host.kill();
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail(`timed out; saw ${JSON.stringify(seen)}`), 30_000);
    host.on("exit", (code) => {
      if (code !== 0 && seen.at(-1) !== "done") fail(`host exited early with ${code}; saw ${JSON.stringify(seen)}`);
    });
    host.on("message", (raw: HostToMain) => {
      seen.push(raw.type);
      if (raw.type === "host.ready") {
        host.postMessage({
          type: "capability.request",
          id: requestId,
          origin: "agent",
          call: { taskId: "host-db-test", capability: "test.echo", input: { text: "hi" }, shapedByUntrusted: false },
        });
      } else if (raw.type === "permission.ask") {
        host.postMessage({ type: "permission.answer", id: raw.id, decision: { decision: "deny" } });
      } else if (raw.type === "capability.result" && raw.id === requestId) {
        callResult = raw.result;
        host.postMessage({ type: "host.query", id: queryId, origin: "ui", query: { kind: "audit.list" } });
      } else if (raw.type === "host.reply" && raw.id === queryId) {
        clearTimeout(timer);
        seen.push("done");
        host.kill();
        resolve({ callResult, reply: raw.reply });
      }
    });
  });
}

app.on("window-all-closed", () => {});
app
  .whenReady()
  .then(run)
  .then((result) => {
    console.log(`HARNESS_RESULT ${JSON.stringify(result)}`);
    app.exit(0);
  })
  .catch((error: unknown) => {
    console.log(`HARNESS_ERROR ${error instanceof Error ? error.stack : String(error)}`);
    app.exit(1);
  });
