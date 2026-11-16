import { z } from "zod";
import {
  HostAuditRefusal,
  HostCapabilityRequest,
  HostCapabilityResult,
  HostQueryMessage,
  HostQueryReplyMessage,
  PermissionAnswerMessage,
  PermissionAskMessage,
} from "./capability.js";

// Route: main <-> host over the utility process port.

export const HostReady = z.object({ type: z.literal("host.ready") }).strict();
export type HostReady = z.infer<typeof HostReady>;

/** Everything the host may send main. */
export const HostToMain = z.discriminatedUnion("type", [
  HostReady,
  HostCapabilityResult,
  PermissionAskMessage,
  HostQueryReplyMessage,
]);
export type HostToMain = z.infer<typeof HostToMain>;

/** Everything main may send the host. */
export const MainToHost = z.discriminatedUnion("type", [
  HostCapabilityRequest,
  HostAuditRefusal,
  PermissionAnswerMessage,
  HostQueryMessage,
]);
export type MainToHost = z.infer<typeof MainToHost>;
