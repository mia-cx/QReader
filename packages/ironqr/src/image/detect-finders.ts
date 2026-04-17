import { otsuBinarize } from './binarize.js';
import {
  type ComponentStats,
  collectComponentStats,
  labelConnectedComponents,
} from './components.js';
import type { FinderCandidate } from './detect.js';
import { detectFinderCandidatePool } from './detect.js';
import { detectFinderCandidatesFlood } from './detect-flood.js';
import type { OklabContrastField, OklabVector } from './oklab.js';
import { assertImagePlaneLength } from './validation.js';

interface ModuleBlob extends ComponentStats {
  readonly radius: number;
  readonly aspect: number;
  readonly fill: number;
}

interface FinderSeed {
  readonly cx: number;
  readonly cy: number;
  readonly moduleSize: number;
  readonly hModuleSize?: number;
  readonly vModuleSize?: number;
  readonly axisU?: { x: number; y: number };
  readonly axisV?: { x: number; y: number };
  readonly source: 'row-scan' | 'flood' | 'blob';
}

interface AffineHypothesis {
  readonly cx: number;
  readonly cy: number;
  readonly ux: number;
  readonly uy: number;
  readonly vx: number;
  readonly vy: number;
}

interface ScoredHypothesis extends AffineHypothesis {
  readonly score: number;
}

const MATCHER_MAX_RESULTS = 32;
const MATCHER_DUPLICATE_RADIUS = 1.2;
const MATCHER_MAX_BLOB_ASPECT = 2.5;
const MATCHER_MIN_BLOB_FILL = 0.12;
const MATCHER_MAX_BLOBS = 600;
const MATCHER_MAX_SEEDS = 160;
const MATCHER_MAX_HYPOTHESES_PER_SEED = 48;
const MATCHER_MAX_BLOB_BASES = 8;
const MATCHER_MAX_NEAREST_BLOBS = 6;
const MATCHER_BLOB_BLOB_DUPLICATE_RADIUS = 0.45;
const MATCHER_MIXED_SEED_DUPLICATE_RADIUS = 2;
const MATCHER_MIN_AXIS_ANGLE = 40;
const MATCHER_MAX_AXIS_ANGLE = 140;
const MATCHER_MAX_AXIS_RATIO = 1.7;
const MATCHER_REFINEMENT_SCALE_DELTA = 0.15;
const MATCHER_REFINEMENT_PASSES = 3;
const MATCHER_STALLED_STEP_DECAY = 0.5;
const MATCHER_IMPROVED_STEP_DECAY = 0.6;
const MATCHER_MIN_DETERMINANT_RATIO = 0.25;
const MATCHER_MIN_AXIS_LENGTH = 0.5;
const MATCHER_MIN_SCORE = 2.5;
const MATCHER_ASPECT_PENALTY_WEIGHT = 0.7;
const MATCHER_SKEW_PENALTY_WEIGHT = 0.5;

const FINDER_DARK_CELLS = buildCells(
  (row, col) =>
    row === 0 ||
    row === 6 ||
    col === 0 ||
    col === 6 ||
    (row >= 2 && row <= 4 && col >= 2 && col <= 4),
);
const FINDER_LIGHT_CELLS = buildCells(
  (row, col) =>
    row >= 1 && row <= 5 && col >= 1 && col <= 5 && !(row >= 2 && row <= 4 && col >= 2 && col <= 4),
);
const FINDER_CENTER_CELLS = buildCells((row, col) => row >= 2 && row <= 4 && col >= 2 && col <= 4);
const FINDER_OUTER_CELLS = buildCells(
  (row, col) => row === 0 || row === 6 || col === 0 || col === 6,
);
const FINDER_QUIET_CELLS = buildCells(
  (row, col) =>
    row >= -1 &&
    row <= 7 &&
    col >= -1 &&
    col <= 7 &&
    !(row >= 0 && row <= 6 && col >= 0 && col <= 6),
  -1,
  7,
);

/**
 * Unified transform-aware finder matcher.
 *
 * Existing row-scan and flood-fill detectors become seed generators. Each seed,
 * plus high-contrast component centroids from the OKLab evidence magnitude,
 * is scored against the canonical 7×7 finder layout under a local affine warp.
 */
export const detectFinderCandidatesMatcher = (
  binary: Uint8Array,
  width: number,
  height: number,
  contrast: OklabContrastField,
): FinderCandidate[] => {
  assertImagePlaneLength(binary.length, width, height, 'detectFinderCandidatesMatcher(binary)');
  assertImagePlaneLength(
    contrast.magnitude.length,
    contrast.width,
    contrast.height,
    'detectFinderCandidatesMatcher(contrast)',
  );
  if (contrast.width !== width || contrast.height !== height) {
    throw new RangeError(
      `detectFinderCandidatesMatcher: binary is ${width}×${height}, contrast is ${contrast.width}×${contrast.height}.`,
    );
  }

  const rowScanPool = detectFinderCandidatePool(binary, width, height);
  const floodPool = detectFinderCandidatesFlood(binary, width, height);
  const blobs = collectModuleBlobs(contrast, width, height);
  const seeds = collectSeeds(rowScanPool, floodPool, blobs);
  if (seeds.length === 0) return [];

  const scored: FinderCandidate[] = [];
  for (const seed of seeds) {
    const hypotheses = buildHypotheses(seed, blobs);
    for (const hypothesis of hypotheses) {
      const refined = refineHypothesis(hypothesis, contrast);
      if (refined === null) continue;
      const hLength = Math.hypot(refined.ux, refined.uy);
      const vLength = Math.hypot(refined.vx, refined.vy);
      const moduleSize = (hLength + vLength) / 2;
      scored.push({
        cx: refined.cx,
        cy: refined.cy,
        moduleSize,
        hModuleSize: hLength,
        vModuleSize: vLength,
        axisU: normalised(refined.ux, refined.uy),
        axisV: normalised(refined.vx, refined.vy),
        score: refined.score,
        source: 'matcher',
      });
    }
  }

  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const deduped: FinderCandidate[] = [];
  for (const candidate of scored) {
    const duplicate = deduped.some((existing) => {
      const distance = Math.hypot(existing.cx - candidate.cx, existing.cy - candidate.cy);
      return (
        distance < Math.min(existing.moduleSize, candidate.moduleSize) * MATCHER_DUPLICATE_RADIUS
      );
    });
    if (!duplicate) deduped.push(candidate);
    if (deduped.length >= MATCHER_MAX_RESULTS) break;
  }

  return deduped;
};

const collectModuleBlobs = (
  contrast: OklabContrastField,
  width: number,
  height: number,
): ModuleBlob[] => {
  const inverted = new Uint8Array(contrast.magnitude.length);
  for (let i = 0; i < inverted.length; i += 1) inverted[i] = 255 - (contrast.magnitude[i] ?? 0);
  const binary = otsuBinarize(inverted, width, height);
  const labels = labelConnectedComponents(binary, width, height);
  const components = collectComponentStats(labels, binary, width, height);
  const minPixels = Math.max(4, Math.floor(Math.min(width, height) / 128));
  const maxPixels = Math.max(minPixels + 1, (width * height) >> 6);

  const blobs = components
    .filter((component) => component.color === 0)
    .map((component): ModuleBlob => {
      const w = component.maxX - component.minX + 1;
      const h = component.maxY - component.minY + 1;
      const boxArea = w * h;
      return {
        ...component,
        radius: Math.sqrt(component.pixelCount / Math.PI),
        aspect: Math.max(w, h) / Math.max(1, Math.min(w, h)),
        fill: component.pixelCount / boxArea,
      };
    })
    .filter(
      (blob) =>
        blob.pixelCount >= minPixels &&
        blob.pixelCount <= maxPixels &&
        blob.aspect <= MATCHER_MAX_BLOB_ASPECT &&
        blob.fill >= MATCHER_MIN_BLOB_FILL,
    );

  blobs.sort((a, b) => b.pixelCount * b.fill - a.pixelCount * a.fill);
  return blobs.slice(0, MATCHER_MAX_BLOBS);
};

const collectSeeds = (
  rowScanPool: readonly FinderCandidate[],
  floodPool: readonly FinderCandidate[],
  blobs: readonly ModuleBlob[],
): FinderSeed[] => {
  const seeds: FinderSeed[] = [];

  for (const candidate of rowScanPool) {
    seeds.push({
      cx: candidate.cx,
      cy: candidate.cy,
      moduleSize: candidate.moduleSize,
      hModuleSize: candidate.hModuleSize,
      vModuleSize: candidate.vModuleSize,
      ...(candidate.axisU ? { axisU: candidate.axisU } : {}),
      ...(candidate.axisV ? { axisV: candidate.axisV } : {}),
      source: 'row-scan',
    });
  }

  for (const candidate of floodPool) {
    seeds.push({
      cx: candidate.cx,
      cy: candidate.cy,
      moduleSize: candidate.moduleSize,
      hModuleSize: candidate.hModuleSize,
      vModuleSize: candidate.vModuleSize,
      ...(candidate.axisU ? { axisU: candidate.axisU } : {}),
      ...(candidate.axisV ? { axisV: candidate.axisV } : {}),
      source: 'flood',
    });
  }

  for (const blob of blobs) {
    const moduleSize = estimateBlobModuleSize(blob, blobs);
    if (moduleSize === null) continue;
    seeds.push({
      cx: blob.centroidX,
      cy: blob.centroidY,
      moduleSize,
      source: 'blob',
    });
  }

  seeds.sort((a, b) => b.moduleSize - a.moduleSize);
  return dedupeSeeds(seeds).slice(0, MATCHER_MAX_SEEDS);
};

const estimateBlobModuleSize = (blob: ModuleBlob, blobs: readonly ModuleBlob[]): number | null => {
  const distances: number[] = [];
  for (const other of blobs) {
    if (other === blob) continue;
    const distance = Math.hypot(other.centroidX - blob.centroidX, other.centroidY - blob.centroidY);
    if (distance < blob.radius * 1.5 || distance > blob.radius * 12) continue;
    distances.push(distance);
  }
  if (distances.length === 0) return null;
  distances.sort((a, b) => a - b);
  return median(distances.slice(0, MATCHER_MAX_NEAREST_BLOBS));
};

const dedupeSeeds = (seeds: readonly FinderSeed[]): FinderSeed[] => {
  const deduped: FinderSeed[] = [];
  for (const seed of seeds) {
    const duplicate = deduped.some((existing) => {
      const distance = Math.hypot(existing.cx - seed.cx, existing.cy - seed.cy);
      // Blob seeds are low-confidence centroids from thresholded contrast
      // islands, so blob↔blob dedupe stays tight. Mixed-source matches can be
      // a bit farther apart because the stronger row/flood seeds often land on
      // the same finder with different center estimates under skew.
      const thresholdFactor =
        seed.source === 'blob' && existing.source === 'blob'
          ? MATCHER_BLOB_BLOB_DUPLICATE_RADIUS
          : MATCHER_MIXED_SEED_DUPLICATE_RADIUS;
      return distance < Math.min(existing.moduleSize, seed.moduleSize) * thresholdFactor;
    });
    if (!duplicate) deduped.push(seed);
  }
  return deduped;
};

const buildHypotheses = (
  seed: FinderSeed,
  blobs: readonly ModuleBlob[],
): readonly AffineHypothesis[] => {
  const hypotheses: AffineHypothesis[] = [];

  if (seed.axisU && seed.axisV) {
    hypotheses.push({
      cx: seed.cx,
      cy: seed.cy,
      ux: seed.axisU.x * (seed.hModuleSize ?? seed.moduleSize),
      uy: seed.axisU.y * (seed.hModuleSize ?? seed.moduleSize),
      vx: seed.axisV.x * (seed.vModuleSize ?? seed.moduleSize),
      vy: seed.axisV.y * (seed.vModuleSize ?? seed.moduleSize),
    });
  }

  if (seed.source === 'blob') {
    const blobBases = blobBasisHypotheses(seed, blobs);
    if (blobBases.length > 0) {
      hypotheses.push(...recenterBlobHypotheses(seed, blobBases.slice(0, MATCHER_MAX_BLOB_BASES)));
      return hypotheses.slice(0, MATCHER_MAX_HYPOTHESES_PER_SEED);
    }
  }

  hypotheses.push(...orthogonalBank(seed.cx, seed.cy, seed.moduleSize));
  return hypotheses.slice(0, MATCHER_MAX_HYPOTHESES_PER_SEED);
};

const orthogonalBank = (cx: number, cy: number, moduleSize: number): AffineHypothesis[] => {
  const hypotheses: AffineHypothesis[] = [];
  const aspectRatios = [1, 0.8, 1.25] as const;
  const shearFactors = [0, -0.2, 0.2] as const;
  for (let angleDeg = 0; angleDeg < 180; angleDeg += 15) {
    const angle = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const aspect of aspectRatios) {
      const ux = cos * moduleSize * aspect;
      const uy = sin * moduleSize * aspect;
      const baseVx = (-sin * moduleSize) / aspect;
      const baseVy = (cos * moduleSize) / aspect;
      for (const shear of shearFactors) {
        hypotheses.push({
          cx,
          cy,
          ux,
          uy,
          vx: baseVx + ux * shear,
          vy: baseVy + uy * shear,
        });
      }
    }
  }
  return hypotheses;
};

const blobBasisHypotheses = (
  seed: FinderSeed,
  blobs: readonly ModuleBlob[],
): AffineHypothesis[] => {
  const vectors = blobs
    .map((blob) => ({
      x: blob.centroidX - seed.cx,
      y: blob.centroidY - seed.cy,
      d: Math.hypot(blob.centroidX - seed.cx, blob.centroidY - seed.cy),
    }))
    .filter((vector) => vector.d >= seed.moduleSize * 0.5 && vector.d <= seed.moduleSize * 1.8)
    .sort((a, b) => a.d - b.d)
    .slice(0, 10);

  const hypotheses: AffineHypothesis[] = [];
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const u = vectors[i];
      const v = vectors[j];
      if (!u || !v) continue;
      const angle = angleBetween(u.x, u.y, v.x, v.y);
      const ratio = Math.max(u.d, v.d) / Math.max(1e-6, Math.min(u.d, v.d));
      if (
        angle < MATCHER_MIN_AXIS_ANGLE ||
        angle > MATCHER_MAX_AXIS_ANGLE ||
        ratio > MATCHER_MAX_AXIS_RATIO
      ) {
        continue;
      }
      hypotheses.push({ cx: seed.cx, cy: seed.cy, ux: u.x, uy: u.y, vx: v.x, vy: v.y });
    }
  }

  if (hypotheses.length > 0) return hypotheses;

  const primary = vectors[0];
  if (!primary) return [];
  const perp = normalised(-primary.y, primary.x);
  return [
    {
      cx: seed.cx,
      cy: seed.cy,
      ux: primary.x,
      uy: primary.y,
      vx: perp.x * seed.moduleSize,
      vy: perp.y * seed.moduleSize,
    },
  ];
};

const recenterBlobHypotheses = (
  seed: FinderSeed,
  bases: readonly AffineHypothesis[],
): AffineHypothesis[] => {
  const recentered: AffineHypothesis[] = [];
  for (const basis of bases) {
    for (const cell of FINDER_DARK_CELLS) {
      recentered.push({
        cx: seed.cx - (cell.col - 3) * basis.ux - (cell.row - 3) * basis.vx,
        cy: seed.cy - (cell.col - 3) * basis.uy - (cell.row - 3) * basis.vy,
        ux: basis.ux,
        uy: basis.uy,
        vx: basis.vx,
        vy: basis.vy,
      });
    }
  }
  return recentered;
};

const refineHypothesis = (
  initial: AffineHypothesis,
  contrast: OklabContrastField,
): ScoredHypothesis | null => {
  const scoredInitial = scoreHypothesis(initial, contrast);
  if (scoredInitial === null) return null;
  let current: ScoredHypothesis = scoredInitial;

  let step = 1;
  for (let pass = 0; pass < MATCHER_REFINEMENT_PASSES; pass += 1) {
    let improved = false;

    while (true) {
      let next = current;
      for (const candidate of buildRefinementCandidates(current, step)) {
        const scored = scoreHypothesis(candidate, contrast);
        if (scored !== null && scored.score > next.score) {
          next = scored;
        }
      }
      if (next === current) break;
      current = next;
      improved = true;
    }

    if (!improved) step *= MATCHER_STALLED_STEP_DECAY;
    else step *= MATCHER_IMPROVED_STEP_DECAY;
  }

  return current;
};

const buildRefinementCandidates = (
  current: AffineHypothesis,
  step: number,
): readonly AffineHypothesis[] => {
  return [
    current,
    { ...current, cx: current.cx + current.ux * step, cy: current.cy + current.uy * step },
    { ...current, cx: current.cx - current.ux * step, cy: current.cy - current.uy * step },
    { ...current, cx: current.cx + current.vx * step, cy: current.cy + current.vy * step },
    { ...current, cx: current.cx - current.vx * step, cy: current.cy - current.vy * step },
    {
      ...current,
      cx: current.cx + (current.ux + current.vx) * step,
      cy: current.cy + (current.uy + current.vy) * step,
    },
    {
      ...current,
      cx: current.cx - (current.ux + current.vx) * step,
      cy: current.cy - (current.uy + current.vy) * step,
    },
    {
      ...current,
      cx: current.cx + (current.ux - current.vx) * step,
      cy: current.cy + (current.uy - current.vy) * step,
    },
    {
      ...current,
      cx: current.cx - (current.ux - current.vx) * step,
      cy: current.cy - (current.uy - current.vy) * step,
    },
    {
      ...current,
      ux: current.ux * (1 + step * MATCHER_REFINEMENT_SCALE_DELTA),
      uy: current.uy * (1 + step * MATCHER_REFINEMENT_SCALE_DELTA),
    },
    {
      ...current,
      ux: current.ux * (1 - step * MATCHER_REFINEMENT_SCALE_DELTA),
      uy: current.uy * (1 - step * MATCHER_REFINEMENT_SCALE_DELTA),
    },
    {
      ...current,
      vx: current.vx * (1 + step * MATCHER_REFINEMENT_SCALE_DELTA),
      vy: current.vy * (1 + step * MATCHER_REFINEMENT_SCALE_DELTA),
    },
    {
      ...current,
      vx: current.vx * (1 - step * MATCHER_REFINEMENT_SCALE_DELTA),
      vy: current.vy * (1 - step * MATCHER_REFINEMENT_SCALE_DELTA),
    },
    {
      ...current,
      vx: current.vx + current.ux * step * MATCHER_REFINEMENT_SCALE_DELTA,
      vy: current.vy + current.uy * step * MATCHER_REFINEMENT_SCALE_DELTA,
    },
    {
      ...current,
      vx: current.vx - current.ux * step * MATCHER_REFINEMENT_SCALE_DELTA,
      vy: current.vy - current.uy * step * MATCHER_REFINEMENT_SCALE_DELTA,
    },
  ];
};

const scoreHypothesis = (
  hypothesis: AffineHypothesis,
  contrast: OklabContrastField,
): ScoredHypothesis | null => {
  const uLen = Math.hypot(hypothesis.ux, hypothesis.uy);
  const vLen = Math.hypot(hypothesis.vx, hypothesis.vy);
  if (uLen < 1 || vLen < 1) return null;
  const det = Math.abs(hypothesis.ux * hypothesis.vy - hypothesis.uy * hypothesis.vx);
  if (det < uLen * vLen * MATCHER_MIN_DETERMINANT_RATIO) return null;

  const centerMean = meanVectors(FINDER_CENTER_CELLS, hypothesis, contrast);
  const outerMean = meanVectors(FINDER_OUTER_CELLS, hypothesis, contrast);
  const gapMean = meanVectors(FINDER_LIGHT_CELLS, hypothesis, contrast);
  const quietMean = meanVectors(FINDER_QUIET_CELLS, hypothesis, contrast, true);
  if (centerMean === null || outerMean === null || gapMean === null || quietMean === null)
    return null;

  const darkMean = {
    l: (centerMean.l * 2 + outerMean.l) / 3,
    a: (centerMean.a * 2 + outerMean.a) / 3,
    b: (centerMean.b * 2 + outerMean.b) / 3,
  };
  const lightMean = {
    l: (gapMean.l + quietMean.l) / 2,
    a: (gapMean.a + quietMean.a) / 2,
    b: (gapMean.b + quietMean.b) / 2,
  };

  const axis = {
    l: darkMean.l - lightMean.l,
    a: darkMean.a - lightMean.a,
    b: darkMean.b - lightMean.b,
  };
  const axisLength = Math.hypot(axis.l, axis.a, axis.b);
  if (axisLength < MATCHER_MIN_AXIS_LENGTH) return null;
  const unit = { l: axis.l / axisLength, a: axis.a / axisLength, b: axis.b / axisLength };

  const centerProjection = dot(centerMean, unit);
  const outerProjection = dot(outerMean, unit);
  const gapProjection = dot(gapMean, unit);
  const quietProjection = dot(quietMean, unit);
  if (centerProjection <= gapProjection || outerProjection <= gapProjection) return null;

  const aspectPenalty = Math.abs(Math.log(uLen / vLen));
  const skewPenalty = Math.abs(
    (hypothesis.ux * hypothesis.vx + hypothesis.uy * hypothesis.vy) / (uLen * vLen),
  );
  const score =
    (centerProjection - gapProjection) * 3 +
    (outerProjection - gapProjection) * 2 +
    (gapProjection - quietProjection) +
    axisLength * 1.5 -
    aspectPenalty * MATCHER_ASPECT_PENALTY_WEIGHT -
    skewPenalty * MATCHER_SKEW_PENALTY_WEIGHT;
  if (score < MATCHER_MIN_SCORE) return null;

  return { ...hypothesis, score };
};

const meanVectors = (
  cells: readonly Readonly<{ row: number; col: number }>[],
  hypothesis: AffineHypothesis,
  contrast: OklabContrastField,
  allowOutOfBounds = false,
): OklabVector | null => {
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  let count = 0;
  for (const cell of cells) {
    const x = hypothesis.cx + (cell.col - 3) * hypothesis.ux + (cell.row - 3) * hypothesis.vx;
    const y = hypothesis.cy + (cell.col - 3) * hypothesis.uy + (cell.row - 3) * hypothesis.vy;
    if (x < 0 || x >= contrast.width || y < 0 || y >= contrast.height) {
      if (allowOutOfBounds) continue;
      return null;
    }
    const sample = contrast.sample(x, y);
    sumL += sample.l;
    sumA += sample.a;
    sumB += sample.b;
    count += 1;
  }
  if (count === 0) return null;
  return { l: sumL / count, a: sumA / count, b: sumB / count };
};

function buildCells(
  predicate: (row: number, col: number) => boolean,
  min = 0,
  max = 6,
): readonly Readonly<{ row: number; col: number }>[] {
  const cells: Array<Readonly<{ row: number; col: number }>> = [];
  for (let row = min; row <= max; row += 1) {
    for (let col = min; col <= max; col += 1) {
      if (predicate(row, col)) cells.push({ row, col });
    }
  }
  return cells;
}

const angleBetween = (ax: number, ay: number, bx: number, by: number): number => {
  const dotProduct = ax * bx + ay * by;
  const denom = Math.max(1e-6, Math.hypot(ax, ay) * Math.hypot(bx, by));
  const cosine = Math.max(-1, Math.min(1, dotProduct / denom));
  return (Math.acos(cosine) * 180) / Math.PI;
};

const normalised = (x: number, y: number): { x: number; y: number } => {
  const length = Math.hypot(x, y);
  if (length === 0) return { x: 1, y: 0 };
  return { x: x / length, y: y / length };
};

const dot = (a: OklabVector, b: OklabVector): number => a.l * b.l + a.a * b.a + a.b * b.b;

const median = (values: readonly number[]): number => {
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[mid] ?? 0;
  return ((values[mid - 1] ?? 0) + (values[mid] ?? 0)) / 2;
};
