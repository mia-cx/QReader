import type { BrowserImageSource } from '../contracts/scan.js';

/**
 * Structural match for anything that already looks like raw pixel data, so
 * non-DOM hosts (Bun, Node tooling, workers) can pass in `{ width, height,
 * data }` buffers without constructing a real `ImageData` instance.
 */
const isImageDataLike = (value: unknown): value is ImageData => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as {
    readonly width?: unknown;
    readonly height?: unknown;
    readonly data?: unknown;
  };

  return (
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number' &&
    candidate.data instanceof Uint8ClampedArray
  );
};

/**
 * Converts any supported browser image source into an `ImageData` object.
 *
 * Accepts anything that is already pixel-backed (real `ImageData` or the
 * structural equivalent). Otherwise falls back to `createImageBitmap` +
 * `OffscreenCanvas`, which is the standard browser path.
 *
 * @param source - Browser image source to convert.
 * @returns An `ImageData` containing the full pixel content of the source.
 */
export const toImageData = async (source: BrowserImageSource): Promise<ImageData> => {
  if (isImageDataLike(source)) {
    return source;
  }

  const bitmap = await createImageBitmap(source);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    bitmap.close();
    throw new Error('Failed to get 2d context from OffscreenCanvas.');
  }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
};
