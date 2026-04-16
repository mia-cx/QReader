/**
 * Shared test helpers for constructing synthetic QR image fixtures.
 *
 * Provides a v1 QR grid builder and a family of ImageData renderers
 * (plain, inverted, low-contrast, color) for use across unit test files.
 */
import {
  buildDataModulePositions,
  buildFormatInfoCodeword,
  buildFunctionModuleMask,
  FORMAT_INFO_FIRST_COPY_POSITIONS,
  getFormatInfoSecondCopyPositions,
  getVersionBlockInfo,
  maskApplies,
  rsEncode,
} from '../src/qr/index.js';

// ─── Types ────────────────────────────────────────────────────────────────

export type Ecl = 'L' | 'M' | 'Q' | 'H';

// ─── Minimal ImageData stand-in ──────────────────────────────────────────

/**
 * Minimal ImageData stand-in for Bun test environments where the browser API
 * is absent. Shape matches what toGrayscale, otsuBinarize, sampleGrid etc. expect.
 */
export const makeImageData = (
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): ImageData => {
  return { width, height, data: pixels, colorSpace: 'srgb' } as unknown as ImageData;
};

// ─── Grid-to-pixels renderers ─────────────────────────────────────────────

export const PIXELS_PER_MODULE = 10;

/**
 * Renders a boolean QR grid to RGBA pixels at {@link PIXELS_PER_MODULE} px/module.
 * Dark modules → black (0,0,0,255); light modules → white (255,255,255,255).
 */
export const gridToImageData = (grid: boolean[][]): ImageData => {
  return renderGrid(grid, 0, 255);
};

/**
 * Inverted rendering: light modules on a dark background.
 * Dark modules → white (255,255,255,255); light modules → black (0,0,0,255).
 */
export const gridToImageDataInverted = (grid: boolean[][]): ImageData => {
  return renderGrid(grid, 255, 0);
};

/**
 * Low-contrast rendering: modules are dark gray / light gray instead of black / white.
 * @param darkValue  Pixel value for dark modules (default 60).
 * @param lightValue Pixel value for light modules (default 195).
 */
export const gridToImageDataLowContrast = (
  grid: boolean[][],
  darkValue = 60,
  lightValue = 195,
): ImageData => {
  return renderGrid(grid, darkValue, lightValue);
};

/**
 * Color rendering: dark modules use an arbitrary RGB triple instead of black.
 * Useful for checking whether the luma-based pipeline handles saturated colors.
 *
 * @param darkRgb   [r, g, b] for dark modules (default deep blue [0, 0, 139]).
 * @param lightRgb  [r, g, b] for light modules (default white [255, 255, 255]).
 */
export const gridToImageDataColor = (
  grid: boolean[][],
  darkRgb: readonly [number, number, number] = [0, 0, 139],
  lightRgb: readonly [number, number, number] = [255, 255, 255],
): ImageData => {
  return renderGridColor(grid, darkRgb, lightRgb);
};

// ─── Private renderers ───────────────────────────────────────────────────

const renderGrid = (grid: boolean[][], darkValue: number, lightValue: number): ImageData => {
  const modules = grid.length;
  const imageSize = modules * PIXELS_PER_MODULE;
  const pixels = new Uint8ClampedArray(imageSize * imageSize * 4);

  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      const dark = grid[row]?.[col] ?? false;
      const value = dark ? darkValue : lightValue;
      fillModuleCell(pixels, imageSize, row, col, value, value, value);
    }
  }

  return makeImageData(imageSize, imageSize, pixels);
};

const renderGridColor = (
  grid: boolean[][],
  darkRgb: readonly [number, number, number],
  lightRgb: readonly [number, number, number],
): ImageData => {
  const modules = grid.length;
  const imageSize = modules * PIXELS_PER_MODULE;
  const pixels = new Uint8ClampedArray(imageSize * imageSize * 4);

  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      const dark = grid[row]?.[col] ?? false;
      const [r, g, b] = dark ? darkRgb : lightRgb;
      fillModuleCell(pixels, imageSize, row, col, r ?? 0, g ?? 0, b ?? 0);
    }
  }

  return makeImageData(imageSize, imageSize, pixels);
};

const fillModuleCell = (
  pixels: Uint8ClampedArray,
  imageSize: number,
  row: number,
  col: number,
  r: number,
  g: number,
  b: number,
): void => {
  for (let pr = 0; pr < PIXELS_PER_MODULE; pr += 1) {
    for (let pc = 0; pc < PIXELS_PER_MODULE; pc += 1) {
      const px = (row * PIXELS_PER_MODULE + pr) * imageSize + col * PIXELS_PER_MODULE + pc;
      pixels[px * 4] = r;
      pixels[px * 4 + 1] = g;
      pixels[px * 4 + 2] = b;
      pixels[px * 4 + 3] = 255;
    }
  }
};

// ─── Version 1 grid builder ──────────────────────────────────────────────

const V1_SIZE = 21;
const V1_VERSION = 1;

export const appendBits = (bits: number[], value: number, length: number): void => {
  for (let bit = length - 1; bit >= 0; bit -= 1) {
    bits.push((value >> bit) & 1);
  }
};

const bytesFromBits = (bits: readonly number[]): number[] => {
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value << 1) | (bits[i + bit] ?? 0);
    }
    bytes.push(value);
  }
  return bytes;
};

export const finalizeV1DataCodewords = (payloadBits: readonly number[], ecl: Ecl): number[] => {
  const { dataCodewords: totalDataCodewords } = getVersionBlockInfo(V1_VERSION, ecl);
  const totalBits = totalDataCodewords * 8;
  const bits = Array.from(payloadBits);
  appendBits(bits, 0, Math.min(4, totalBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  let padByte = 0xec;
  while (bits.length < totalBits) {
    appendBits(bits, padByte, 8);
    padByte = padByte === 0xec ? 0x11 : 0xec;
  }
  return bytesFromBits(bits);
};

export const buildVersion1Grid = (
  dataCodewords: readonly number[],
  ecl: Ecl,
  maskPattern: number,
): boolean[][] => {
  const { ecCodewordsPerBlock } = getVersionBlockInfo(V1_VERSION, ecl);
  const matrix = Array.from({ length: V1_SIZE }, () =>
    Array.from({ length: V1_SIZE }, () => false),
  );
  const reserved = buildFunctionModuleMask(V1_SIZE, V1_VERSION);
  const allCodewords = [
    ...dataCodewords,
    ...Array.from(rsEncode(dataCodewords, ecCodewordsPerBlock)),
  ];
  const bits: number[] = [];

  const set = (row: number, col: number, value: boolean): void => {
    const r = matrix[row];
    if (r) r[col] = value;
  };

  const drawFinder = (top: number, left: number): void => {
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        const dark =
          row === 0 ||
          row === 6 ||
          col === 0 ||
          col === 6 ||
          (row >= 2 && row <= 4 && col >= 2 && col <= 4);
        set(top + row, left + col, dark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, V1_SIZE - 7);
  drawFinder(V1_SIZE - 7, 0);

  for (let i = 8; i < V1_SIZE - 8; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  const formatBits = buildFormatInfoCodeword(ecl, maskPattern);
  for (let i = 0; i < FORMAT_INFO_FIRST_COPY_POSITIONS.length; i += 1) {
    const pos = FORMAT_INFO_FIRST_COPY_POSITIONS[i];
    if (pos) set(pos[0], pos[1], ((formatBits >> (14 - i)) & 1) === 1);
  }
  for (let i = 0; i < getFormatInfoSecondCopyPositions(V1_SIZE).length; i += 1) {
    const pos = getFormatInfoSecondCopyPositions(V1_SIZE)[i];
    if (pos) set(pos[0], pos[1], ((formatBits >> (14 - i)) & 1) === 1);
  }

  set(V1_SIZE - 8, 8, true);

  for (const cw of allCodewords) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      bits.push((cw >> bit) & 1);
    }
  }

  const positions = buildDataModulePositions(V1_SIZE, reserved);
  for (let i = 0; i < positions.length; i += 1) {
    const position = positions[i];
    if (!position) continue;
    const [row, col] = position;
    const bit = bits[i] === 1;
    set(row, col, maskApplies(maskPattern, row, col) ? !bit : bit);
  }

  return matrix;
};

// ─── Geometric transforms ────────────────────────────────────────────────

/**
 * Applies a true projective warp to a rendered QR image, simulating viewing
 * a planar QR through a camera at an angle.
 *
 * Maps the source image's four corners to a trapezoidal output where the
 * bottom edge is compressed by `keystoneRatio` (e.g. 0.20 = bottom 20%
 * narrower than top) AND the bottom is also pulled up by the same ratio,
 * giving a homography-representable perspective — not a pure-x trapezoid,
 * which would contain a uv cross-term no homography can model.
 *
 * Uses inverse bilinear sampling so every output pixel has a defined value.
 *
 * @param grid - Boolean QR module grid.
 * @param keystoneRatio - Fractional inset at the bottom corners (0–0.4).
 */
export const gridToImageDataPerspective = (grid: boolean[][], keystoneRatio = 0.2): ImageData => {
  const source = gridToImageData(grid);
  const W = source.width;
  const H = source.height;

  // Forward map: source corners → output corners.
  // Bottom inset both horizontally (narrower) and vertically (lifted).
  const inset = keystoneRatio * W;
  const liftY = keystoneRatio * H * 0.5;
  const dst = {
    tl: { x: 0, y: 0 },
    tr: { x: W, y: 0 },
    bl: { x: inset, y: H - liftY },
    br: { x: W - inset, y: H - liftY },
  };
  const src = {
    tl: { x: 0, y: 0 },
    tr: { x: W, y: 0 },
    bl: { x: 0, y: H },
    br: { x: W, y: H },
  };

  // Solve the inverse homography directly: given destination (output) pixel,
  // recover source coordinates. Map dst → src.
  const H_inv = solve8([dst.tl, dst.tr, dst.bl, dst.br], [src.tl, src.tr, src.bl, src.br]);

  const out = new Uint8ClampedArray(W * H * 4);
  out.fill(255);

  const sample = (sx: number, sy: number, ch: number): number => {
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const fx = sx - x0;
    const fy = sy - y0;
    const at = (x: number, y: number) =>
      source.data[
        Math.max(0, Math.min(H - 1, y)) * W * 4 + Math.max(0, Math.min(W - 1, x)) * 4 + ch
      ] ?? 255;
    return (
      at(x0, y0) * (1 - fx) * (1 - fy) +
      at(x0 + 1, y0) * fx * (1 - fy) +
      at(x0, y0 + 1) * (1 - fx) * fy +
      at(x0 + 1, y0 + 1) * fx * fy
    );
  };

  for (let oy = 0; oy < H; oy += 1) {
    for (let ox = 0; ox < W; ox += 1) {
      const denom = H_inv[6] * ox + H_inv[7] * oy + 1;
      const sx = (H_inv[0] * ox + H_inv[1] * oy + H_inv[2]) / denom;
      const sy = (H_inv[3] * ox + H_inv[4] * oy + H_inv[5]) / denom;
      if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
      const base = (oy * W + ox) * 4;
      out[base] = sample(sx, sy, 0);
      out[base + 1] = sample(sx, sy, 1);
      out[base + 2] = sample(sx, sy, 2);
      out[base + 3] = 255;
    }
  }

  return makeImageData(W, H, out);
};

/**
 * Solves the 8 free homography parameters (h33 fixed at 1) that send the
 * four `from` points to the four `to` points. Used by perspective fixture
 * helpers — production geometry has its own least-squares solver.
 */
const solve8 = (
  from: readonly [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ],
  to: readonly [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ],
): [number, number, number, number, number, number, number, number] => {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const f = from[i]!;
    const t = to[i]!;
    A.push([f.x, f.y, 1, 0, 0, 0, -t.x * f.x, -t.x * f.y]);
    b.push(t.x);
    A.push([0, 0, 0, f.x, f.y, 1, -t.y * f.x, -t.y * f.y]);
    b.push(t.y);
  }
  // Solve 8x8 linear system via Gaussian elimination.
  const aug = A.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < 8; i += 1) {
    let pivot = i;
    let pivotMag = Math.abs(aug[i]![i]!);
    for (let r = i + 1; r < 8; r += 1) {
      if (Math.abs(aug[r]![i]!) > pivotMag) {
        pivot = r;
        pivotMag = Math.abs(aug[r]![i]!);
      }
    }
    if (pivot !== i) [aug[i], aug[pivot]] = [aug[pivot]!, aug[i]!];
    const piv = aug[i]![i]!;
    for (let r = 0; r < 8; r += 1) {
      if (r === i) continue;
      const f = aug[r]![i]! / piv;
      if (f === 0) continue;
      for (let c = i; c <= 8; c += 1) aug[r]![c] = aug[r]![c]! - f * aug[i]![c]!;
    }
  }
  const x = new Array<number>(8).fill(0);
  for (let i = 0; i < 8; i += 1) x[i] = aug[i]![8]! / aug[i]![i]!;
  return x as [number, number, number, number, number, number, number, number];
};

// ─── Convenience: build a v1 "HI" alphanumeric grid at mask 0, ECL M ────

export const buildHiGrid = (): boolean[][] => {
  const bits: number[] = [];
  appendBits(bits, 0b0010, 4); // mode: alphanumeric
  appendBits(bits, 2, 9); // character count
  appendBits(bits, 17 * 45 + 18, 11); // "HI"
  return buildVersion1Grid(finalizeV1DataCodewords(bits, 'M'), 'M', 0);
};
