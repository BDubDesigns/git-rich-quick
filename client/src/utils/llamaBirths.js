/**
 * New hire on the farm (issue #218, Slice 6 of the #210 game-feel
 * pass): what a breed result pops, as pure functions so the server
 * test suite pins them. Presentation only: breeding, odds and prices
 * are untouched.
 *
 * FARM_BREED_RESULT records state.lastBirths (transient, never saved,
 * cleared by a restore): { seq, atMs, stalls, newTypeStalls,
 * badgeRose } from the farm before and after the result.
 * - stalls: every stall a kid was actually placed in. Each pops (the
 *   llama scales 0.4 to 1.1 to 1, a pink +1 chip rises 24px and fades).
 * - newTypeStalls: the first stall of each type this result unlocked;
 *   it gets a one-time gold stall outline.
 * - badgeRose: whether the #204 birth count actually rose. Only then
 *   does the Farm tab badge bump. Births watched on the Farm (the count
 *   stays 0) never bump a hidden badge, and a load never bumps at all.
 */
import { farmUnseenBirths } from "../../../shared/game-balance.js";

/** The pop, the chip, the outline and the badge bump, ms (LlamaBirth.css). */
export const LLAMA_BIRTH_MS = 500;

/** How far the +1 chip rises out of the stall, px. */
export const BIRTH_CHIP_RISE_PX = 24;

/** A birth this recent still pops a Farm that just mounted. */
export const LLAMA_BIRTH_FRESH_MS = 1000;

/** The record for a breed result, or the previous one when no kid was placed. */
export function birthRecord(prevFarm, nextFarm, prevRecord, nowMs) {
  const before = prevFarm?.stalls ?? [];
  const after = nextFarm?.stalls ?? [];
  const stalls = [];
  for (let i = 0; i < after.length; i += 1) {
    if (!before[i]?.llama && after[i]?.llama) stalls.push(i);
  }
  if (stalls.length === 0) return prevRecord ?? null;
  const known = new Set(prevFarm?.unlockedTypes ?? []);
  const newTypeStalls = [];
  for (const i of stalls) {
    const type = after[i].llama;
    if (!known.has(type)) {
      known.add(type);
      newTypeStalls.push(i);
    }
  }
  return {
    seq: (prevRecord?.seq ?? 0) + 1,
    atMs: nowMs,
    stalls,
    newTypeStalls,
    badgeRose: farmUnseenBirths(nextFarm) > farmUnseenBirths(prevFarm),
  };
}

/** What stall `index` shows for a record: { pop, newType } or null. */
export function stallBirth(record, index) {
  if (!record || !record.stalls.includes(index)) return null;
  return { pop: true, newType: record.newTypeStalls.includes(index) };
}

/** Whether a record pops a Farm that just mounted: fresh. */
export function birthsFreshOnMount(record, nowMs) {
  return Boolean(record) && nowMs - record.atMs <= LLAMA_BIRTH_FRESH_MS;
}

/** The badge's bump key after a new record: its seq only when the count rose. */
export function badgeBumpAfter(currentKey, record) {
  return record?.badgeRose ? record.seq : currentKey;
}
