import { Effect } from 'effect';
import sharp from 'sharp';
import { scanFrame } from '../src/image/index.js';
import type { AutoScan } from './schema.js';

const makeImageData = (width: number, height: number, pixels: Uint8ClampedArray): ImageData => {
  return { width, height, data: pixels, colorSpace: 'srgb' } as unknown as ImageData;
};

const readImageData = (imagePath: string) => {
  return Effect.tryPromise(async () => {
    const { data, info } = await sharp(imagePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return makeImageData(info.width, info.height, new Uint8ClampedArray(data));
  });
};

const emptyAutoScan = (): AutoScan => {
  return {
    attempted: true,
    succeeded: false,
    results: [],
  };
};

const scanLocalImageFileEffect = (imagePath: string) => {
  return Effect.gen(function* () {
    const imageData = yield* readImageData(imagePath);
    const results = yield* scanFrame(imageData).pipe(
      Effect.catch(() => Effect.succeed([])),
    );

    if (results.length === 0) {
      return emptyAutoScan();
    }

    return {
      attempted: true,
      succeeded: true,
      results: results.map((result) => ({
        text: result.payload.text,
        kind: result.payload.kind,
      })),
    } satisfies AutoScan;
  });
};

export const scanLocalImageFile = (imagePath: string): Promise<AutoScan> => {
  return Effect.runPromise(scanLocalImageFileEffect(imagePath));
};
