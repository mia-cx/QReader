import { Effect } from 'effect';
import type { BrowserImageSource, ScanResult } from '../contracts/scan.js';
import { decodeGridLogical } from '../qr/index.js';
import { otsuBinarize, toGrayscale } from './binarize.js';
import { detectFinderPatterns } from './detect.js';
import { resolveGrid } from './geometry.js';
import { toImageData } from './image.js';
import { sampleGrid } from './sample.js';

/**
 * Builds the single-frame QR scanning pipeline as an Effect program.
 *
 * Pipeline: toImageData → toGrayscale → otsuBinarize → detectFinderPatterns
 *   → resolveGrid → sampleGrid → decodeGridLogical → ScanResult[].
 *
 * Both normal and inverted binary orientations are attempted so that
 * light-on-dark (inverted polarity) QR codes are handled transparently.
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
    const binary = otsuBinarize(luma, width, height);

    // Try normal polarity first, then inverted.  Light-on-dark QR codes
    // (e.g. white modules on a black background) are indistinguishable from
    // normal codes after polarity inversion, so we attempt both orientations
    // and return the first successful decode.
    const inverted = invertBinary(binary);

    for (const candidate of [binary, inverted]) {
      const finders = detectFinderPatterns(candidate, width, height);
      if (finders.length < 3) continue;

      const resolution = resolveGrid(finders);
      if (resolution === null) continue;

      const grid = sampleGrid(width, height, resolution, candidate);

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

    return [] as ScanResult[];
  });
};

/** Returns a new binary array with 0↔255 swapped. */
const invertBinary = (binary: Uint8Array): Uint8Array => {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary[i] === 0 ? 255 : 0;
  }
  return out;
};
