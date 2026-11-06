import type { IdlEvents, Program } from "@anchor-lang/core";
import { EventParser } from "./anchor.js";
import type { Leash } from "./idl.js";

type Events = IdlEvents<Leash>;

/** A decoded program event and the transaction it came from. */
export type LeashEvent = {
  [K in keyof Events]: { name: K; data: Events[K]; signature: string };
}[keyof Events];

/**
 * Decodes the events in a transaction's logs. Uses the program's coder because its IDL is
 * camelCased, which is what the types above promise. The raw IDL decodes to snake_case fields.
 */
export function parseEvents(
  program: Program<Leash>,
  logs: string[],
  signature: string
): LeashEvent[] {
  const parser = new EventParser(program.programId, program.coder);
  return [...parser.parseLogs(logs)].map((e) => ({ ...e, signature } as LeashEvent));
}
