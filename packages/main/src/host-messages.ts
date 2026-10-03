import { describeIssues, HostToMain, type Log } from "@totum/shared";

/** Handles one message from the host process. */
export function handleHostMessage(raw: unknown, log: Log): void {
  const parsed = HostToMain.safeParse(raw);
  if (!parsed.success) {
    log("warn", "main: dropped invalid message from host", {
      issues: describeIssues(parsed.error),
    });
    return;
  }

  switch (parsed.data.type) {
    case "host.ready":
      log("info", "main: host ready");
      return;
  }
}
