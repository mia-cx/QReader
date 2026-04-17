import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import {
  detectFinderPatterns,
  otsuBinarize,
  resolveGrid,
  sampleGrid,
  toGrayscale,
} from '../../src/image/index.js';
import { decodeGridLogical } from '../../src/qr/index.js';
import {
  appendBits,
  buildVersion1Grid,
  finalizeV1DataCodewords,
  gridToImageData,
  makeImageData,
} from '../helpers.js';

describe('single-image baseline pipeline (internal modules)', () => {
  it('toGrayscale converts an all-white ImageData to all-255 luma', () => {
    const width = 10;
    const height = 10;
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    const imageData = makeImageData(width, height, pixels);
    const luma = toGrayscale(imageData);
    expect(luma.every((value) => value === 255)).toBe(true);
  });

  it('toGrayscale converts an all-black ImageData to all-0 luma', () => {
    const width = 4;
    const height = 4;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i + 3] = 255;
    }
    const imageData = makeImageData(width, height, pixels);
    const luma = toGrayscale(imageData);
    expect(luma.every((value) => value === 0)).toBe(true);
  });

  it('toGrayscale composites fully transparent pixels onto white (matches browser behaviour)', () => {
    const width = 4;
    const height = 4;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const imageData = makeImageData(width, height, pixels);
    const luma = toGrayscale(imageData);
    expect(luma.every((value) => value === 255)).toBe(true);
  });

  it('toGrayscale composites partial alpha onto white (50% opaque black → ~128)', () => {
    const width = 2;
    const height = 2;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i + 3] = 128;
    }
    const imageData = makeImageData(width, height, pixels);
    const luma = toGrayscale(imageData);
    for (const value of luma) {
      expect(value).toBeGreaterThanOrEqual(126);
      expect(value).toBeLessThanOrEqual(129);
    }
  });

  it('otsuBinarize on a blank (all-white) image returns all-255 (light)', () => {
    const width = 100;
    const height = 100;
    const luma = new Uint8Array(width * height).fill(255);
    const binary = otsuBinarize(luma, width, height);
    expect(binary.every((value) => value === 255)).toBe(true);
  });

  it('detectFinderPatterns returns fewer than 3 candidates for a blank image', () => {
    const width = 210;
    const height = 210;
    const binary = new Uint8Array(width * height).fill(255);
    const finders = detectFinderPatterns(binary, width, height);
    expect(finders.length).toBeLessThan(3);
  });

  const buildHiGrid = () => {
    const bits: number[] = [];
    appendBits(bits, 0b0010, 4);
    appendBits(bits, 2, 9);
    appendBits(bits, 17 * 45 + 18, 11);
    return buildVersion1Grid(finalizeV1DataCodewords(bits, 'M'), 'M', 0);
  };

  it('detects 3 finder patterns in a synthetic v1-M QR image at 10px/module', () => {
    const imageData = gridToImageData(buildHiGrid());
    const luma = toGrayscale(imageData);
    const binary = otsuBinarize(luma, imageData.width, imageData.height);
    const finders = detectFinderPatterns(binary, imageData.width, imageData.height);
    expect(finders.length).toBe(3);
  });

  it('resolveGrid returns a valid GridResolution from 3 finder candidates', () => {
    const imageData = gridToImageData(buildHiGrid());
    const luma = toGrayscale(imageData);
    const binary = otsuBinarize(luma, imageData.width, imageData.height);
    const finders = detectFinderPatterns(binary, imageData.width, imageData.height);
    expect(finders.length).toBe(3);
    const [topLeft, topRight, bottomLeft] = finders;
    if (!topLeft || !topRight || !bottomLeft) throw new Error('Expected exactly three finders.');

    const resolution = resolveGrid([topLeft, topRight, bottomLeft]);
    expect(resolution).not.toBeNull();
    expect(resolution?.version).toBe(1);
    expect(resolution?.size).toBe(21);
  });

  it('full internal pipeline decodes a synthetic v1-M "HI" QR image', async () => {
    const imageData = gridToImageData(buildHiGrid());
    const luma = toGrayscale(imageData);
    const binary = otsuBinarize(luma, imageData.width, imageData.height);
    const finders = detectFinderPatterns(binary, imageData.width, imageData.height);
    expect(finders.length).toBe(3);
    const [topLeft, topRight, bottomLeft] = finders;
    if (!topLeft || !topRight || !bottomLeft) throw new Error('Expected exactly three finders.');

    const resolution = resolveGrid([topLeft, topRight, bottomLeft]);
    expect(resolution).not.toBeNull();
    if (resolution === null) return;

    const sampledGrid = sampleGrid(imageData.width, imageData.height, resolution, binary);
    const result = await Effect.runPromise(decodeGridLogical({ grid: sampledGrid }));

    expect(result.payload.text).toBe('HI');
    expect(result.version).toBe(1);
    expect(result.errorCorrectionLevel).toBe('M');
  });

  it('not-found path: detectFinderPatterns returns fewer than 3 candidates for a blank image', () => {
    const width = 210;
    const height = 210;
    const luma = new Uint8Array(width * height).fill(255);
    const binary = otsuBinarize(luma, width, height);
    const finders = detectFinderPatterns(binary, width, height);
    expect(finders.length).toBeLessThan(3);
  });
});
