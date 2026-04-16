import type { Bounds, CornerSet, Point } from '../contracts/geometry.js';
import type { FinderCandidate } from './detect.js';

/**
 * The result of resolving a QR grid from finder pattern candidates.
 */
export interface GridResolution {
  /** Estimated QR version (1-40). */
  readonly version: number;
  /** Total number of modules per side. */
  readonly size: number;
  /** Pixel-coordinate corners of the QR symbol boundary. */
  readonly corners: CornerSet;
  /** Bounding box of the QR symbol in pixels. */
  readonly bounds: Bounds;
  /** The underlying projective transform from module coords to pixel coords. */
  readonly homography: Homography;
  /**
   * Maps a grid (row, col) module coordinate to a pixel (x, y) center.
   *
   * @param gridRow - Zero-based module row.
   * @param gridCol - Zero-based module column.
   * @returns Pixel coordinates of the module center.
   */
  readonly samplePoint: (gridRow: number, gridCol: number) => Point;
}

/**
 * Resolves a QR grid layout from three finder pattern candidates.
 *
 * Identifies which finder is top-left / top-right / bottom-left from the
 * hypotenuse, estimates the QR version from inter-finder distances, then
 * fits a projective homography from each finder's four detected outer
 * corners. The homography maps (col, row) module coordinates to pixel
 * coordinates and stays accurate at the QR's far corner under perspective
 * distortion (where a 3-point affine drifts by several modules).
 *
 * @param finders - Exactly 3 finder pattern candidates.
 * @param overrideVersion - Optional 1–40 version override. When omitted we
 *   estimate the version from finder distances, but at v≥7 the version is
 *   redundantly encoded in two corner blocks; if the finder-distance estimate
 *   lands one module off, the size mismatch breaks decoding entirely. Callers
 *   that want to retry with v±1/±2 around the estimate should pass each
 *   candidate version explicitly.
 * @returns Grid resolution for sampling, or null if geometry cannot be resolved.
 */
export const resolveGrid = (
  finders: readonly FinderCandidate[],
  overrideVersion?: number,
): GridResolution | null => {
  if (finders.length < 3) return null;

  const oriented = orientFinders(finders);
  if (oriented === null) return null;
  const { topLeft, topRight, bottomLeft } = oriented;

  const version = overrideVersion ?? estimateVersion(topLeft, topRight, bottomLeft);
  if (version < 1 || version > 40) return null;
  const size = version * 4 + 17;

  // Each finder spans 7 modules; its center sits at module (3, 3) within itself.
  // From the finder center, the four outer corners are 3.5 modules away in each
  // direction, scaled by that finder's own h/v module sizes — capturing the
  // local perspective stretch the affine path averages away.
  const finderOffset = 3;
  const trGridCol = size - 1 - finderOffset;
  const blGridRow = size - 1 - finderOffset;

  type Pair = readonly [Point, Point];
  const pairs: Pair[] = [
    ...finderEdgePairs(topLeft, finderOffset, finderOffset),
    ...finderEdgePairs(topRight, finderOffset, trGridCol),
    ...finderEdgePairs(bottomLeft, blGridRow, finderOffset),
  ];

  // Try projective fit first; fall back to affine if the linear system is
  // degenerate (e.g. perfectly collinear correspondences).
  const homography =
    solveHomography(pairs) ??
    affineHomographyFallback(topLeft, topRight, bottomLeft, finderOffset, trGridCol, blGridRow);
  if (homography === null) return null;

  const samplePoint = (gridRow: number, gridCol: number): Point =>
    applyHomography(homography, gridCol, gridRow);

  // QR outer boundary lies half a module beyond the outermost module centers.
  const cornerTL = samplePoint(-0.5, -0.5);
  const cornerTR = samplePoint(-0.5, size - 0.5);
  const cornerBR = samplePoint(size - 0.5, size - 0.5);
  const cornerBL = samplePoint(size - 0.5, -0.5);

  const corners: CornerSet = {
    topLeft: cornerTL,
    topRight: cornerTR,
    bottomRight: cornerBR,
    bottomLeft: cornerBL,
  };

  const xs = [cornerTL.x, cornerTR.x, cornerBR.x, cornerBL.x];
  const ys = [cornerTL.y, cornerTR.y, cornerBR.y, cornerBL.y];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const bounds: Bounds = {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };

  return { version, size, corners, bounds, homography, samplePoint };
};

/** A user-supplied (module-coord, pixel-coord) correspondence used to refine the homography. */
export interface ExtraCorrespondence {
  readonly moduleRow: number;
  readonly moduleCol: number;
  readonly pixelX: number;
  readonly pixelY: number;
}

/**
 * Refits the QR grid homography using the standard 3-finder correspondences
 * plus extra anchor points (e.g. a located alignment pattern center). Used
 * after `resolveGrid` succeeds and we want to tighten the grid against
 * additional verified landmarks before re-sampling.
 *
 * @param finders - The same 3 finders previously passed to `resolveGrid`.
 * @param version - The version (and therefore size) to use.
 * @param extraPoints - Additional (module, pixel) correspondences.
 * @returns A new GridResolution with refined sampling, or null on degenerate fit.
 */
export const resolveGridFromCorrespondences = (
  finders: readonly [FinderCandidate, FinderCandidate, FinderCandidate],
  version: number,
  extraPoints: readonly ExtraCorrespondence[],
): GridResolution | null => {
  if (version < 1 || version > 40) return null;
  const oriented = orientFinders(finders);
  if (oriented === null) return null;
  const { topLeft, topRight, bottomLeft } = oriented;

  const size = version * 4 + 17;
  const finderOffset = 3;
  const trGridCol = size - 1 - finderOffset;
  const blGridRow = size - 1 - finderOffset;

  type Pair = readonly [Point, Point];
  const pairs: Pair[] = [
    ...finderEdgePairs(topLeft, finderOffset, finderOffset),
    ...finderEdgePairs(topRight, finderOffset, trGridCol),
    ...finderEdgePairs(bottomLeft, blGridRow, finderOffset),
    ...extraPoints.map(
      (p): Pair => [
        { x: p.moduleCol, y: p.moduleRow },
        { x: p.pixelX, y: p.pixelY },
      ],
    ),
  ];

  const homography =
    solveHomography(pairs) ??
    affineHomographyFallback(topLeft, topRight, bottomLeft, finderOffset, trGridCol, blGridRow);
  if (homography === null) return null;

  const samplePoint = (gridRow: number, gridCol: number): Point =>
    applyHomography(homography, gridCol, gridRow);

  const cornerTL = samplePoint(-0.5, -0.5);
  const cornerTR = samplePoint(-0.5, size - 0.5);
  const cornerBR = samplePoint(size - 0.5, size - 0.5);
  const cornerBL = samplePoint(size - 0.5, -0.5);

  const corners: CornerSet = {
    topLeft: cornerTL,
    topRight: cornerTR,
    bottomRight: cornerBR,
    bottomLeft: cornerBL,
  };

  const xs = [cornerTL.x, cornerTR.x, cornerBR.x, cornerBL.x];
  const ys = [cornerTL.y, cornerTR.y, cornerBR.y, cornerBL.y];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const bounds: Bounds = {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };

  return { version, size, corners, bounds, homography, samplePoint };
};

/**
 * Returns plausible QR versions for a finder triple, ordered most-likely first:
 * the finder-distance estimate, then ±1, then ±2. Useful when the estimate
 * lands close-but-wrong and the encoded version info disagrees with grid size.
 */
export const candidateVersions = (
  finders: readonly FinderCandidate[],
  span = 2,
): readonly number[] => {
  if (finders.length < 3) return [];
  const oriented = orientFinders(finders);
  if (oriented === null) return [];
  const estimate = estimateVersion(oriented.topLeft, oriented.topRight, oriented.bottomLeft);
  const seen = new Set<number>();
  const ordered: number[] = [];
  const add = (v: number): void => {
    if (v < 1 || v > 40 || seen.has(v)) return;
    seen.add(v);
    ordered.push(v);
  };
  add(estimate);
  for (let d = 1; d <= span; d += 1) {
    add(estimate + d);
    add(estimate - d);
  }
  return ordered;
};

// ─── Finder orientation & version ─────────────────────────────────────────

interface OrientedFinders {
  readonly topLeft: FinderCandidate;
  readonly topRight: FinderCandidate;
  readonly bottomLeft: FinderCandidate;
}

const orientFinders = (finders: readonly FinderCandidate[]): OrientedFinders | null => {
  const [fa, fb, fc] = finders as [FinderCandidate, FinderCandidate, FinderCandidate];
  const dAB = distFinders(fa, fb);
  const dAC = distFinders(fa, fc);
  const dBC = distFinders(fb, fc);

  // Top-left is the finder opposite the hypotenuse.
  let topLeft: FinderCandidate;
  let topRight: FinderCandidate;
  let bottomLeft: FinderCandidate;
  if (dAB >= dAC && dAB >= dBC) {
    topLeft = fc;
    topRight = fa;
    bottomLeft = fb;
  } else if (dAC >= dAB && dAC >= dBC) {
    topLeft = fb;
    topRight = fa;
    bottomLeft = fc;
  } else {
    topLeft = fa;
    topRight = fb;
    bottomLeft = fc;
  }

  // Enforce right-handed orientation (TR to the right of TL→BL line in image coords).
  if (cross2(topLeft, topRight, bottomLeft) < 0) {
    [topRight, bottomLeft] = [bottomLeft, topRight];
  }

  return { topLeft, topRight, bottomLeft };
};

const estimateVersion = (
  topLeft: FinderCandidate,
  topRight: FinderCandidate,
  bottomLeft: FinderCandidate,
): number => {
  const avgModuleSize = (topLeft.moduleSize + topRight.moduleSize + bottomLeft.moduleSize) / 3;
  const avgFinderDist = (distFinders(topLeft, topRight) + distFinders(topLeft, bottomLeft)) / 2;
  const modulesAcross = avgFinderDist / avgModuleSize;
  // modulesAcross = size - 7 = (version * 4 + 17) - 7 = version * 4 + 10
  const raw = Math.round((modulesAcross - 10) / 4);
  return Math.max(1, Math.min(40, raw));
};

// ─── Finder corner correspondences ────────────────────────────────────────

/**
 * Builds five (module-space, pixel-space) correspondences for a finder
 * centered at (centerRow, centerCol) module coordinates: the center plus
 * the four edge midpoints.
 *
 * Edge midpoints are the right correspondence to use because `hModuleSize`
 * is measured along the horizontal scan row (so cx ± 3.5h are the finder's
 * left/right extents at y = cy) and `vModuleSize` is measured along the
 * vertical scan column (so cy ± 3.5v are the top/bottom extents at x = cx).
 * Under perspective warp these five points are still accurate — the four
 * geometric corners are not, since a warped finder isn't a rectangle.
 */
const finderEdgePairs = (
  finder: FinderCandidate,
  centerRow: number,
  centerCol: number,
): readonly (readonly [Point, Point])[] => {
  const half = 3.5; // 7/2 modules from center to outer edge
  const dx = half * finder.hModuleSize;
  const dy = half * finder.vModuleSize;

  return [
    // center
    [
      { x: centerCol, y: centerRow },
      { x: finder.cx, y: finder.cy },
    ],
    // right edge midpoint
    [
      { x: centerCol + half, y: centerRow },
      { x: finder.cx + dx, y: finder.cy },
    ],
    // left edge midpoint
    [
      { x: centerCol - half, y: centerRow },
      { x: finder.cx - dx, y: finder.cy },
    ],
    // bottom edge midpoint
    [
      { x: centerCol, y: centerRow + half },
      { x: finder.cx, y: finder.cy + dy },
    ],
    // top edge midpoint
    [
      { x: centerCol, y: centerRow - half },
      { x: finder.cx, y: finder.cy - dy },
    ],
  ];
};

// ─── Homography (8-DOF projective transform) ──────────────────────────────

/**
 * 3×3 homography in row-major order (h11, h12, h13, h21, h22, h23, h31, h32, h33).
 * Maps (col, row, 1) → (x*w, y*w, w); divide x and y by w to get pixel coords.
 */
/**
 * A 3×3 projective transform stored row-major. Maps (col, row, 1) homogeneous
 * module coordinates to pixel coordinates: divide x and y by the third
 * component to get pixel (x, y). The 9th element is fixed at 1 — the
 * transform has 8 free parameters.
 */
export type Homography = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * Solves H from N≥4 (src → dst) correspondences via the standard DLT.
 *
 * Each correspondence contributes two rows to a 2N×8 system A·h = b, where
 * h = (h11..h32) and h33 is fixed at 1 (8 DOF). Solved by normal equations
 * (A^T·A)·h = A^T·b with Gaussian elimination — fast and adequate for the
 * tiny 8×8 systems we feed it.
 *
 * @returns The fitted homography, or null if the system is singular.
 */
const solveHomography = (pairs: readonly (readonly [Point, Point])[]): Homography | null => {
  if (pairs.length < 4) return null;

  // Each correspondence (sx, sy) → (dx, dy) contributes two A rows:
  //   r1 = [sx, sy, 1, 0, 0, 0, -dx*sx, -dx*sy], rhs = dx
  //   r2 = [0, 0, 0, sx, sy, 1, -dy*sx, -dy*sy], rhs = dy
  // We never materialise A: each row folds straight into the running
  // 8×8 normal-equations system M·h = v with M = A^T·A, v = A^T·b.
  // Float64Array gives a typed-zero default and rules out the spurious
  // `undefined` TypeScript otherwise infers from `T[]` access.
  const m = new Float64Array(8 * 8);
  const v = new Float64Array(8);

  for (const pair of pairs) {
    const [src, dst] = pair;
    const r1 = [src.x, src.y, 1, 0, 0, 0, -dst.x * src.x, -dst.x * src.y];
    const r2 = [0, 0, 0, src.x, src.y, 1, -dst.y * src.x, -dst.y * src.y];
    accumulateNormalEquationRow(m, v, r1, dst.x);
    accumulateNormalEquationRow(m, v, r2, dst.y);
  }

  const h = solve8x8(m, v);
  if (h === null) return null;

  return [f(h, 0), f(h, 1), f(h, 2), f(h, 3), f(h, 4), f(h, 5), f(h, 6), f(h, 7), 1];
};

/** Folds one row of A into the running M = A^T·A and v = A^T·b accumulators. */
const accumulateNormalEquationRow = (
  m: Float64Array,
  v: Float64Array,
  row: readonly number[],
  rhs: number,
): void => {
  for (let i = 0; i < 8; i += 1) {
    const ri = row[i] ?? 0;
    if (ri === 0) continue;
    v[i] = f(v, i) + ri * rhs;
    for (let j = 0; j < 8; j += 1) {
      const rj = row[j] ?? 0;
      if (rj === 0) continue;
      const idx = i * 8 + j;
      m[idx] = f(m, idx) + ri * rj;
    }
  }
};

/** Maps a (col, row) module coordinate through `h` to pixel space. */
export const applyHomography = (h: Homography, x: number, y: number): Point => {
  const denom = h[6] * x + h[7] * y + h[8];
  return {
    x: (h[0] * x + h[1] * y + h[2]) / denom,
    y: (h[3] * x + h[4] * y + h[5]) / denom,
  };
};

/**
 * Pure-affine fallback when the projective fit is degenerate. Reproduces the
 * pre-homography behaviour so we never regress for clean square QRs.
 */
const affineHomographyFallback = (
  topLeft: FinderCandidate,
  topRight: FinderCandidate,
  bottomLeft: FinderCandidate,
  finderOffset: number,
  trGridCol: number,
  blGridRow: number,
): Homography => {
  const hModules = trGridCol - finderOffset;
  const vModules = blGridRow - finderOffset;
  const rx = (topRight.cx - topLeft.cx) / hModules;
  const ry = (topRight.cy - topLeft.cy) / hModules;
  const dx = (bottomLeft.cx - topLeft.cx) / vModules;
  const dy = (bottomLeft.cy - topLeft.cy) / vModules;
  const ox = topLeft.cx - finderOffset * rx - finderOffset * dx;
  const oy = topLeft.cy - finderOffset * ry - finderOffset * dy;
  // pixel = origin + col*rightVec + row*downVec (no perspective term).
  return [rx, dx, ox, ry, dy, oy, 0, 0, 1];
};

// ─── Linear algebra helpers ───────────────────────────────────────────────

/**
 * Solves an 8×8 dense system M·x = v via Gaussian elimination with partial
 * pivoting. M is laid out row-major in a Float64Array of length 64.
 * Returns null when the matrix is singular.
 */
// Float64Array reads always return a number, but `noUncheckedIndexedAccess`
// widens them to `number | undefined`. `f` strips that fiction.
const f = (a: Float64Array, i: number): number => a[i] as number;

const solve8x8 = (m: Float64Array, v: Float64Array): Float64Array | null => {
  const n = 8;
  const stride = n + 1;
  // Augmented matrix in one Float64Array (n rows × (n+1) columns).
  const aug = new Float64Array(n * stride);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) aug[i * stride + j] = f(m, i * n + j);
    aug[i * stride + n] = f(v, i);
  }

  for (let i = 0; i < n; i += 1) {
    // Partial pivot: largest |entry| in column i at or below row i.
    let pivotRow = i;
    let pivotMag = Math.abs(f(aug, i * stride + i));
    for (let r = i + 1; r < n; r += 1) {
      const mag = Math.abs(f(aug, r * stride + i));
      if (mag > pivotMag) {
        pivotRow = r;
        pivotMag = mag;
      }
    }
    if (pivotMag < 1e-12) return null;
    if (pivotRow !== i) swapRows(aug, i, pivotRow, stride);

    const pivotVal = f(aug, i * stride + i);
    for (let r = 0; r < n; r += 1) {
      if (r === i) continue;
      const factor = f(aug, r * stride + i) / pivotVal;
      if (factor === 0) continue;
      for (let c = i; c <= n; c += 1) {
        aug[r * stride + c] = f(aug, r * stride + c) - factor * f(aug, i * stride + c);
      }
    }
  }

  const x = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    x[i] = f(aug, i * stride + n) / f(aug, i * stride + i);
  }
  return x;
};

const swapRows = (aug: Float64Array, a: number, b: number, stride: number): void => {
  for (let c = 0; c < stride; c += 1) {
    const ai = a * stride + c;
    const bi = b * stride + c;
    const tmp = f(aug, ai);
    aug[ai] = f(aug, bi);
    aug[bi] = tmp;
  }
};

// ─── Tiny vector helpers ──────────────────────────────────────────────────

const distFinders = (a: FinderCandidate, b: FinderCandidate): number =>
  Math.sqrt((b.cx - a.cx) ** 2 + (b.cy - a.cy) ** 2);

const cross2 = (a: FinderCandidate, b: FinderCandidate, c: FinderCandidate): number =>
  (b.cx - a.cx) * (c.cy - a.cy) - (b.cy - a.cy) * (c.cx - a.cx);
