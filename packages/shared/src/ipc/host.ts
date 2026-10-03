import { z } from "zod";

// Route: host -> main over the utility process port. One-way events.

export const HostReady = z.object({ type: z.literal("host.ready") }).strict();
export type HostReady = z.infer<typeof HostReady>;

/** Everything the host may send main. */
export const HostToMain = z.discriminatedUnion("type", [HostReady]);
export type HostToMain = z.infer<typeof HostToMain>;
