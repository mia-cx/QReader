import { Effect } from 'effect';
import type { BrowserImageSource, ScanResult } from '../contracts/scan.js';
import { decodeGridLogical } from '../qr/index.js';
import { otsuBinarize, sauvolaBinarize, toChannelGray, toGrayscale } from './binarize.js';
import {
  detectFinderCandidatePool,
  type FinderCandidate,
  findBestFinderTriples,
} from './detect.js';
import { detectFinderCandidatesFlood } from './detect-flood.js';
import { candidateVersions, resolveGrid } from './geometry.js';
import { toImageData } from './image.js';
import { refineGridFitness } from './refine-fitness.js';
import { sampleGrid } from './sample.js';

/**
 * Builds the single-frame QR scanning pipeline as an Effect program.
 *
 * Pipeline: toImageData → toGrayscale → binarize → detectFinderPatterns
 *   → resolveGrid → sampleGrid → decodeGridLogical → ScanResult[].
 *
 * Tries multiple binarization strategies and both polarities. Otsu (global
 * threshold) is fast and works for clean inputs; Sauvola (adaptive local
 * threshold) handles non-uniform illumination, small QRs in textured
 * scenes, and high-key photos where the QR's local foreground/background
 * relationship differs from the global one. Both polarities cover
 * light-on-dark QR codes.
 *
 * Succeeds with an empty array when no QR symbol is detected or decoding
 * fails. Fails through the Effect error channel when `toImageData` throws.
 *
 * @param input - Any supported browser image source.
 * @returns An Effect yielding one `ScanResult` per decoded QR symbol found.
 */
export const scanFrame = (input: BrowserImageSource) => {
  return Effect.gen(function* () {
    const imageData = yield* Effect.tryPromise(() => toImageData(input));
    const { width, height } = imageData;

    const luma = toGrayscale(imageData);

    // Order matters: cheap and most-likely-to-succeed first. Otsu normal
    // catches clean printed QRs in one pass; Sauvola is the fallback for
    // photos with non-uniform lighting or busy backgrounds. Inverted
    // variants handle light-on-dark codes.
    // Layered binarization: cheap Otsu first, then Sauvola at two scales,
    // then per-channel grayscale (R/G/B) for color QRs whose luma value is
    // pushed toward white by BT.601's heavy green weighting. Each binary is
    // tried in both polarities. Lazy: most images decode on the first try.
    const otsu = otsuBinarize(luma, width, height);
    let sauvolaLarge: Uint8Array | null = null;
    let sauvolaSmall: Uint8Array | null = null;
    let blueGray: Uint8Array | null = null;
    let redGray: Uint8Array | null = null;

    const lazySauvolaLarge = (): Uint8Array => {
      if (sauvolaLarge === null) sauvolaLarge = sauvolaBinarize(luma, width, height);
      return sauvolaLarge;
    };
    const lazySauvolaSmall = (): Uint8Array => {
      if (sauvolaSmall === null) sauvolaSmall = sauvolaBinarize(luma, width, height, 24);
      return sauvolaSmall;
    };
    const lazyBlueOtsu = (): Uint8Array => {
      if (blueGray === null) blueGray = toChannelGray(imageData, 2);
      return otsuBinarize(blueGray, width, height);
    };
    const lazyRedOtsu = (): Uint8Array => {
      if (redGray === null) redGray = toChannelGray(imageData, 0);
      return otsuBinarize(redGray, width, height);
    };

    // Each entry: () => Uint8Array. Order matters — cheapest and most
    // common-success first, exotic fallbacks last.
    const variants: (() => Uint8Array)[] = [
      () => otsu,
      () => invertBinary(otsu),
      lazySauvolaLarge,
      () => invertBinary(lazySauvolaLarge()),
      lazySauvolaSmall,
      () => invertBinary(lazySauvolaSmall()),
      lazyBlueOtsu,
      () => invertBinary(lazyBlueOtsu()),
      lazyRedOtsu,
      () => invertBinary(lazyRedOtsu()),
    ];

    // For each binary candidate, fetch the full finder pool (not just one
    // triple) and try the top-K best-scoring triples. A noisy scene can
    // produce several QR-shaped Ls; only the decoder knows which is real.
    const TRIPLES_PER_BINARY = 8;

    for (const makeCandidate of variants) {
      const candidate = makeCandidate();

      // Combine row-scan candidates (fast, axis-aligned) with flood-fill
      // candidates (rotation-invariant, robust to stylized finders). They
      // detect different things: row-scan catches the canonical 1:1:3:1:1
      // run, flood-fill catches the dark-ring/light-gap/dark-stone topology
      // independent of orientation. Cost: ~50-100ms per megapixel for
      // flood-fill on top of row-scan's ~5ms.
      const rowScanPool = detectFinderCandidatePool(candidate, width, height);
      const floodPool = detectFinderCandidatesFlood(candidate, width, height);
      const pool = mergeFinderPools(rowScanPool, floodPool);
      if (pool.length < 3) continue;

      const triples = findBestFinderTriples(pool, TRIPLES_PER_BINARY);
      if (triples.length === 0) continue;

      for (const triple of triples) {
        // Try the finder-distance version estimate first, then ±1/±2. The
        // estimate is only ~85% reliable for v≥7 where one module of
        // misjudgement gives the wrong grid size; the encoded version info
        // bits in the QR will then refuse to decode against the wrong size.
        for (const version of candidateVersions(triple, 2)) {
          const initialResolution = resolveGrid(triple, version);
          if (initialResolution === null) continue;

          // Hill-climb the homography on the QR's structural fitness
          // (timing patterns, finder signatures, alignment patterns).
          // The QR's own redundancy is the oracle: any perturbation that
          // makes more expected cells match keeps the change. After this
          // pass, version-info and format-info cells land where the spec
          // says they do, even if the initial 3-finder homography was off
          // by a fraction of a module at the far corner.
          const resolution = refineGridFitness(initialResolution, candidate, width, height);

          const grid = sampleGrid(width, height, resolution, candidate);

          // Cheap pre-flight: a real QR's row 6 timing pattern alternates
          // dark/light cleanly between the two top finder separators. If too
          // many cells disagree, the grid geometry is wrong and decode would
          // just fail expensively.
          if (!timingRowLooksValid(grid)) continue;

          const decoded = yield* decodeGridLogical({ grid }).pipe(
            Effect.catch(() => Effect.succeed(null)),
          );

          if (decoded === null) continue;

          const result: ScanResult = {
            payload: decoded.payload,
            // TODO: replace with a real confidence signal (e.g. 1 - bestFormatHammingDistance / 15).
            confidence: 0.9,
            version: decoded.version,
            errorCorrectionLevel: decoded.errorCorrectionLevel,
            bounds: resolution.bounds,
            corners: resolution.corners,
            headers: decoded.headers,
            segments: decoded.segments,
          };

          return [result];
        }
      }
    }

    return [] as ScanResult[];
  });
};

/**
 * Merges row-scan and flood-fill candidate pools, deduping spatially-close
 * candidates (within ~3 modules of each other). Order: row-scan first when
 * both detect the same finder — row-scan's centre is more accurate when the
 * finder is axis-aligned.
 */
const mergeFinderPools = (
  primary: readonly FinderCandidate[],
  secondary: readonly FinderCandidate[],
): FinderCandidate[] => {
  const merged: FinderCandidate[] = [...primary];
  for (const candidate of secondary) {
    const dupe = merged.some((existing) => {
      const minMs = Math.min(existing.moduleSize, candidate.moduleSize);
      const distance = Math.hypot(existing.cx - candidate.cx, existing.cy - candidate.cy);
      return distance < minMs * 3;
    });
    if (!dupe) merged.push(candidate);
  }
  return merged;
};

/** Returns a new binary array with 0↔255 swapped. */
const invertBinary = (binary: Uint8Array): Uint8Array => {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary[i] === 0 ? 255 : 0;
  }
  return out;
};

/**
 * Validates that a sampled grid's row-6 timing pattern alternates dark/light
 * for the expected fraction of cells. The QR spec requires perfect
 * alternation between the two top finders (columns 8..size-9), starting and
 * ending with dark. We tolerate up to 25% error to allow for one or two bad
 * cells from sampling noise; below that, the grid geometry is almost
 * certainly wrong and we should skip the expensive decode attempt.
 */
const timingRowLooksValid = (grid: boolean[][]): boolean => {
  const size = grid.length;
  if (size < 21) return false;
  const row = grid[6];
  if (!row) return false;
  let total = 0;
  let correct = 0;
  for (let col = 8; col <= size - 9; col += 1) {
    const cell = row[col];
    if (cell === undefined) continue;
    const expected = col % 2 === 0; // even columns dark, odd light
    total += 1;
    if (cell === expected) correct += 1;
  }
  if (total === 0) return false;
  return correct / total >= 0.75;
};
