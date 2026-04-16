---
'ironqr': minor
---

Stylized-QR scan path: invert-polarity retry + projective geometry refinement.

- `scanFrame` now retries detection against the inverted binary, so light-on-dark
  QR codes decode without the caller flipping the image.
- `resolveGrid` fits a projective homography from each finder's center plus its
  four edge midpoints (5 correspondences × 3 finders), replacing the 3-point
  affine that drifted by several modules at the QR's far corner under
  perspective distortion.
- `FinderCandidate` now exposes `hModuleSize` and `vModuleSize` separately,
  preserving the per-finder pixel extents the geometry fit needs.
- New `tests/unit/scan-stylized.test.ts` characterises the failure modes
  (polarity, color, low contrast, mild keystone) the slice now handles, with a
  `.todo` for the harder finder-selection problem the next slice tackles.
