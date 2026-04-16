---
'ironqr': minor
---

Architectural change: add flood-fill (connected-component) finder pattern
detection alongside the existing row-scan path, plus fitness-driven
homography refinement.

The row-scan 1:1:3:1:1 detector requires finders to be roughly axis-
aligned. Real-world photos (angled labels, stickers on curved surfaces,
signs at perspective) rotate finders enough that the row scan misses
runs entirely. Flood-fill detects the rotation-invariant topology of a
finder — a dark ring containing a light gap containing a dark stone —
and works on warped, stylized, or partially-occluded finders that the
row scan can't see.

Module size for flood-fill candidates is computed from the ring's pixel
count (`sqrt(area / 24)`) rather than its bounding box, so a tilted
finder doesn't get rejected by the downstream squareness filter that
assumes axis-aligned detection.

The fitness refiner (`refineGridFitness`) hill-climbs the homography
parameters to maximise expected/observed agreement on the QR's
structural cells (timing patterns, finder signatures, alignment
patterns). It runs after every successful `resolveGrid` and locks the
sampling lattice onto the QR's own redundancy as the oracle, instead
of trusting finder centres alone.

The two changes compose: flood-fill produces coarser initial
homographies (centroid of irregular regions vs. precise row-scan
centres), which fitness-jiggle then sharpens.

Newly passing in the corpus: asset-7d03d053ced25f8a (tiny logo-
overlaid v5), asset-b2ba30bc8ca0224a (book-page with corner QR),
asset-84b5879b85b969ca (book page with QR), asset-9c2f0020eb04e932
(perspective-distorted blue billboard at night), asset-1997ec08d630e591
(rotated sticker on cupcake).

Cumulative slice progress: 17/35 → 21/35 (49% → 60%) decode rate;
0/11 false positives.

Also fixes the manifest entry for asset-9c2f0020eb04e932: the QR's
TITLE field is Shift-JIS encoded and our decoder returns the raw
bytes; the manifest now records what the QR actually encodes (with
a note about the original Japanese text).
