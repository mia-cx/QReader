import { describe, expect, it } from 'vitest';
import { decodeGrid } from '../../src/index.js';
import {
  buildDataModulePositions,
  buildFunctionModuleMask,
  buildVersionInfoCodeword,
  getRemainderBits,
  getVersionBlockInfo,
} from '../../src/internal/qr-spec.js';
import { helloWorldV1MGrid } from '../fixtures/hello-world-v1-m.js';
import { helloWorldV7MGrid } from '../fixtures/hello-world-v7-m.js';

describe('decodeGrid', () => {
  it('decodes the version 1-M HELLO WORLD logical grid end-to-end', async () => {
    const result = await decodeGrid({ grid: helloWorldV1MGrid });

    expect(result.version).toBe(1);
    expect(result.errorCorrectionLevel).toBe('M');
    expect(result.payload.kind).toBe('text');
    expect(result.payload.text).toBe('HELLO WORLD');
    expect(new TextDecoder().decode(result.payload.bytes)).toBe('HELLO WORLD');
    expect(result.headers.length).toBeGreaterThan(0);
  });

  it('decodes a version 7-M HELLO WORLD logical grid end-to-end', async () => {
    const result = await decodeGrid({ grid: helloWorldV7MGrid });

    expect(result.version).toBe(7);
    expect(result.errorCorrectionLevel).toBe('M');
    expect(result.payload.kind).toBe('text');
    expect(result.payload.text).toBe('HELLO WORLD');
    expect(new TextDecoder().decode(result.payload.bytes)).toBe('HELLO WORLD');
  });

  it('covers the full QR Model 2 version range in the data-module and RS tables', () => {
    expect(buildVersionInfoCodeword(7)).toBe(0x7c94);

    for (let version = 1; version <= 40; version += 1) {
      const size = 17 + version * 4;
      const reserved = buildFunctionModuleMask(size, version);
      const positions = buildDataModulePositions(size, reserved);
      const blockInfo = getVersionBlockInfo(version, 'M');

      expect(reserved.length).toBe(size);
      expect(positions).toHaveLength(blockInfo.totalCodewords * 8 + getRemainderBits(version));
    }
  });
});
