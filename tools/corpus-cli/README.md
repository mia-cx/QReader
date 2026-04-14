# Real-world corpus toolkit

This directory contains the first-pass tooling for importing real QR-positive and
non-QR-negative image assets into a manifest-driven local corpus.

## Goals

- deterministic local import
- content-hash deduplication
- provenance captured per asset
- explicit review status per asset
- direct export into benchmark-ready positive/negative lists

## On-disk layout

Runtime data lives under `corpus/data/`:

- `corpus/data/manifest.json` — canonical manifest
- `corpus/data/assets/` — imported image files, normalized to WebP and named by content hash id
- `corpus/data/benchmark-real-world.json` — optional local export of all approved assets

Committed perfbench fixture lives under `tools/perfbench/fixtures/real-world/`:

- `tools/perfbench/fixtures/real-world/manifest.json` — curated committed benchmark snapshot
- `tools/perfbench/fixtures/real-world/assets/` — copied fixture assets used by perfbench

Remote scrape staging lives under `corpus/staging/`:

- `corpus/staging/<run-id>/<asset-id>/image.*` — raw scraped image for manual review
- `corpus/staging/<run-id>/<asset-id>/manifest.json` — per-image source metadata

`corpus/staging/` is gitignored. `corpus/data/` (manifest, assets, rejections)
is tracked in the repo so the seed corpus ships out of the box and CI can
exercise real-world images without a local scrape.

## Lawful sourcing and review expectations

Only import assets you are allowed to use for evaluation.

For every asset, capture enough provenance to answer:
- where it came from
- what rights or permission basis we have to store and evaluate it
- whether attribution is required
- whether a human has reviewed the label and asset quality

Do not treat unlabeled scraped imagery as production-ready test data.
Imported assets should begin as `pending` unless someone has actually reviewed
and approved them.

Recommended review checklist:
- label is correct (`qr-positive` vs `non-qr-negative`)
- image is actually usable (not truncated, corrupt, or unrelated)
- provenance / attribution / license notes are present when needed
- duplicates are intentional, or should be collapsed

## Commands

```bash
bun --filter ironqr-corpus-cli run cli --
bun --filter ironqr-corpus-cli run cli -- scrape --label qr-positive --limit 25 https://pixabay.com/images/search/qr%20code/
bun --filter ironqr-corpus-cli run cli -- review corpus/staging/<run-id>
bun --filter ironqr-corpus-cli run cli -- import path/to/file.png
bun --filter ironqr-corpus-cli run cli -- import corpus/staging/<run-id>
bun --filter ironqr-corpus-cli run cli -- build-bench
```

Missing required args prompt in TTY sessions.
No subcommand runs guided scrape → review → import flow.

## Review flow

1. `scrape` downloads raw images into `corpus/staging/<run-id>/...`.
2. `review` prompts for reviewer GitHub username, then walks staged queue one image at a time.
3. On approval, reviewer confirms or edits best-effort license, enters QR count, then tool runs current scanner as review assist. If auto-scan result is correct, it can be accepted as ground truth; otherwise reviewer can enter payloads manually.
4. `import` imports approved staged assets into real corpus manifest and fills missing required metadata.
5. `build-bench` lets user hand-curate committed perfbench fixture from approved corpus assets.

Local and staged imports both normalize imported assets to WebP and scale them down to fit within 1000×1000 while preserving aspect ratio. Staged assets remain raw so review is based on original downloaded file.

Committed perfbench fixture only includes assets user explicitly selected during `build-bench`.
That keeps perfbench regression set small, stable, and reviewable.
