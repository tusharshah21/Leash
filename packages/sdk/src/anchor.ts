import * as namespace from "@anchor-lang/core";

// Node loads this package as CommonJS and cannot see its named exports from ESM, so they sit on
// `default` there. Bundlers load its ESM build, which has real named exports and no default.
const anchor = (namespace as unknown as { default?: typeof namespace }).default ?? namespace;

export const { BN, BorshCoder, EventParser, Program, utils } = anchor;
export type BN = InstanceType<typeof BN>;
