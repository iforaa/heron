/**
 * The one source of randomness in the library, and it is not random.
 *
 * Determinism is a promise Heron makes everywhere: the same scene renders the same
 * bytes, so a reference file can be compared and a defect can be bisected. A
 * `Math.random` anywhere in the drawing path would break that quietly, in a way
 * that reads as a rendering bug rather than as a seeding one.
 *
 * A leaf module with no imports of its own, deliberately. It was briefly a private
 * function in `motion.ts` copied verbatim into `morph.ts`, and promoting it there
 * to share it created a `scene -> morph -> motion -> scene` cycle that left
 * `NEUTRAL` uninitialised at import time. Utilities several layers need belong
 * below all of them.
 */

/** Deterministic 0..1 stream from an integer seed (mulberry32). */
export function seeded(seed: number): () => number {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = Math.imul(a ^ (a >>> 15), a | 1);
    a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
}
