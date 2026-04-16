/**
 * Flood-fill (connected-component) finder pattern detection.
 *
 * The row-scan 1:1:3:1:1 detector in `detect.ts` requires finders to be roughly
 * axis-aligned: a 20° rotation produces runs that no longer fit the expected
 * ratio. Real-world QR images (photographed labels, signs at angles, stickers
 * on curved surfaces) violate that assumption constantly.
 *
 * The finder pattern itself is rotation-invariant: a dark 7×7 ring around a
 * 5×5 light gap around a 3×3 dark stone, regardless of orientation. We can
 * detect that structure by labelling connected components of dark and light
 * pixels, then looking for triples (dark_ring, light_gap, dark_stone) where:
 *   - light_gap is contained within dark_ring
 *   - dark_stone is contained within light_gap
 *   - the dark_stone:dark_ring area ratio is ~9:24 = 0.375 (the QR spec ratio)
 *
 * This is the approach used by quirc (ISC, Daniel Beer) and is what gives
 * modern phone scanners their robustness to rotation and stylized finders.
 *
 * Returns a `FinderCandidate[]` compatible with the row-scan API so it can be
 * merged with that pool in the scan pipeline.
 */
import type { FinderCandidate } from './detect.js';

/**
 * Detects finder pattern candidates by labelling connected components.
 *
 * Returns a list of candidates whose `moduleSize`, `hModuleSize`, and
 * `vModuleSize` are estimated from the ring's bounding-box extents (it spans
 * 7 modules per side). The list is unsorted and unfiltered — callers should
 * dedupe and pick triples themselves.
 */
export const detectFinderCandidatesFlood = (
  binary: Uint8Array,
  width: number,
  height: number,
): FinderCandidate[] => {
  const labels = labelConnectedComponents(binary, width, height);
  const components = collectComponentStats(labels, binary, width, height);
  const parents = computeContainingComponents(labels, components, width, height);

  // Index light components by parent for O(N) ring iteration. Same for stones.
  const lightByParent = new Map<number, ComponentStats[]>();
  const darkByParent = new Map<number, ComponentStats[]>();
  for (const c of components) {
    const map = c.color === 255 ? lightByParent : darkByParent;
    const parentId = parents[c.id] ?? 0;
    const arr = map.get(parentId);
    if (arr) arr.push(c);
    else map.set(parentId, [c]);
  }

  const minPixels = 12;
  const maxPixels = (width * height) >> 2;

  const candidates: FinderCandidate[] = [];
  for (const ring of components) {
    if (ring.color !== 0) continue; // ring must be dark
    if (ring.pixelCount < minPixels || ring.pixelCount > maxPixels) continue;

    const lights = lightByParent.get(ring.id);
    if (!lights) continue;

    for (const light of lights) {
      const stones = darkByParent.get(light.id);
      if (!stones) continue;

      for (const stone of stones) {
        // Validate the area ratio. Dark stone : dark ring = 9 : 24 = 0.375.
        // Allow ±50% slack because pixel rounding distorts small finders heavily.
        const ratio = stone.pixelCount / ring.pixelCount;
        if (ratio < 0.15 || ratio > 0.7) continue;

        // Reject highly elongated rings: a real finder's bounding-box
        // aspect ratio is at most ~2 even under heavy perspective.
        const ringW = ring.maxX - ring.minX + 1;
        const ringH = ring.maxY - ring.minY + 1;
        const aspect = Math.max(ringW, ringH) / Math.min(ringW, ringH);
        if (aspect > 2.5) continue;

        // Module size from area is rotation-invariant: the ring (dark border
        // of a 7×7 finder, hollow inside the inner 5×5) covers 24 modules,
        // so moduleSize = sqrt(ringPixelCount / 24). The bounding-box-based
        // h/v sizes are reported equal to keep downstream code (which assumes
        // axis-aligned row-scan finders) from rejecting tilted finders.
        const moduleSize = Math.sqrt(ring.pixelCount / 24);

        candidates.push({
          cx: ring.centroidX,
          cy: ring.centroidY,
          moduleSize,
          hModuleSize: moduleSize,
          vModuleSize: moduleSize,
        });
      }
    }
  }

  return candidates;
};

// ─── Connected-component labelling ────────────────────────────────────────

const labelConnectedComponents = (
  binary: Uint8Array,
  width: number,
  height: number,
): Uint32Array => {
  const labels = new Uint32Array(width * height);
  const parent: number[] = [0];

  const findRoot = (x: number): number => {
    let cur = x;
    while ((parent[cur] ?? 0) !== cur) {
      const p = parent[cur] ?? 0;
      parent[cur] = parent[p] ?? 0;
      cur = parent[cur] ?? 0;
    }
    return cur;
  };
  const union = (a: number, b: number): number => {
    const ra = findRoot(a);
    const rb = findRoot(b);
    if (ra === rb) return ra;
    if (ra < rb) {
      parent[rb] = ra;
      return ra;
    }
    parent[ra] = rb;
    return rb;
  };

  let nextId = 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const colour = binary[i] ?? 255;
      const leftLabel = x > 0 && (binary[i - 1] ?? 255) === colour ? labels[i - 1] : 0;
      const upLabel = y > 0 && (binary[i - width] ?? 255) === colour ? labels[i - width] : 0;

      if (leftLabel && upLabel) {
        labels[i] = union(leftLabel, upLabel);
      } else if (leftLabel) {
        labels[i] = leftLabel;
      } else if (upLabel) {
        labels[i] = upLabel;
      } else {
        labels[i] = nextId;
        parent[nextId] = nextId;
        nextId += 1;
      }
    }
  }

  for (let i = 0; i < labels.length; i += 1) {
    labels[i] = findRoot(labels[i] ?? 0);
  }

  return labels;
};

// ─── Component statistics ─────────────────────────────────────────────────

interface ComponentStats {
  readonly id: number;
  readonly color: number;
  pixelCount: number;
  sumX: number;
  sumY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centroidX: number;
  centroidY: number;
}

const collectComponentStats = (
  labels: Uint32Array,
  binary: Uint8Array,
  width: number,
  height: number,
): ComponentStats[] => {
  const byId = new Map<number, ComponentStats>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const id = labels[i] ?? 0;
      if (id === 0) continue;
      let stats = byId.get(id);
      if (!stats) {
        stats = {
          id,
          color: binary[i] ?? 255,
          pixelCount: 0,
          sumX: 0,
          sumY: 0,
          minX: x,
          maxX: x,
          minY: y,
          maxY: y,
          centroidX: 0,
          centroidY: 0,
        };
        byId.set(id, stats);
      }
      stats.pixelCount += 1;
      stats.sumX += x;
      stats.sumY += y;
      if (x < stats.minX) stats.minX = x;
      if (x > stats.maxX) stats.maxX = x;
      if (y < stats.minY) stats.minY = y;
      if (y > stats.maxY) stats.maxY = y;
    }
  }
  for (const s of byId.values()) {
    s.centroidX = s.sumX / s.pixelCount;
    s.centroidY = s.sumY / s.pixelCount;
  }
  return Array.from(byId.values());
};

// ─── Containment hierarchy ────────────────────────────────────────────────

/**
 * Returns each component id mapped to the id of the component that
 * immediately contains it, or 0 for top-level components.
 *
 * Strategy: probe the pixel directly above the component's top-edge centre.
 * That pixel must belong to either a different component (the parent) or
 * be out of frame (root).
 */
const computeContainingComponents = (
  labels: Uint32Array,
  components: readonly ComponentStats[],
  width: number,
  height: number,
): Record<number, number> => {
  const parents: Record<number, number> = { 0: 0 };
  for (const c of components) {
    if (c.minY === 0) {
      parents[c.id] = 0;
      continue;
    }
    const probeX = Math.round((c.minX + c.maxX) / 2);
    const probeY = c.minY - 1;
    if (probeX < 0 || probeX >= width || probeY < 0 || probeY >= height) {
      parents[c.id] = 0;
      continue;
    }
    const parentId = labels[probeY * width + probeX] ?? 0;
    parents[c.id] = parentId === c.id ? 0 : parentId;
  }
  return parents;
};
