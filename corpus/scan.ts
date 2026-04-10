import { Effect } from 'effect';
import sharp from 'sharp';
import {
  detectFinderPatterns,
  otsuBinarize,
  resolveGrid,
  sampleGrid,
  toGrayscale,
} from '../src/image/index.js';
import { decodeGridLogical } from '../src/qr/index.js';
import type { AutoScan } from './schema.js';

function makeImageData(width: number, height: number, pixels: Uint8ClampedArray): ImageData {
  return { width, height, data: pixels, colorSpace: 'srgb' } as unknown as ImageData;
}

export async function scanLocalImageFile(imagePath: string): Promise<AutoScan> {
  const { data, info } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const imageData = makeImageData(info.width, info.height, new Uint8ClampedArray(data));
  const luma = toGrayscale(imageData);
  const binary = otsuBinarize(luma, imageData.width, imageData.height);
  const finders = detectFinderPatterns(binary, imageData.width, imageData.height);

  if (finders.length < 3) {
    return {
      attempted: true,
      succeeded: false,
      results: [],
    };
  }

  const resolution = resolveGrid(finders);
  if (resolution === null) {
    return {
      attempted: true,
      succeeded: false,
      results: [],
    };
  }

  const grid = sampleGrid(imageData.width, imageData.height, resolution, binary);

  try {
    const decoded = await Effect.runPromise(decodeGridLogical({ grid }));
    return {
      attempted: true,
      succeeded: true,
      results: [
        {
          text: decoded.payload.text,
          kind: decoded.payload.kind,
        },
      ],
    };
  } catch {
    return {
      attempted: true,
      succeeded: false,
      results: [],
    };
  }
}
