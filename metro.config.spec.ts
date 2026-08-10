import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type ImageSize = ((input: Uint8Array) => { width: number; height: number }) & {
  disableTypes(types: string[]): void;
};

const nodeRequire = createRequire(import.meta.url);
const imageSize = nodeRequire('image-size') as ImageSize;

function makeBox(name: string, payload = ''): Buffer {
  const box = Buffer.alloc(8 + Buffer.byteLength(payload));
  box.writeUInt32BE(box.length, 0);
  box.write(name, 4, 4, 'ascii');
  box.write(payload, 8, 'ascii');
  return box;
}

describe('Metro image parser hardening', () => {
  beforeAll(() => {
    const hardeningPath = nodeRequire.resolve('./scripts/harden-metro-image-parsers.js');
    delete nodeRequire.cache[hardeningPath];
    nodeRequire(hardeningPath);
  });

  afterAll(() => {
    imageSize.disableTypes([]);
  });

  it.each([
    ['icns', Buffer.from('icns000000000000', 'ascii')],
    ['heif', makeBox('ftyp', 'heic')],
    ['jxl', Buffer.concat([makeBox('JXL ', '\r\n\x87\n'), makeBox('ftyp', 'jxl ')])],
  ])('rejects vulnerable %s input before its parser runs', (type, input) => {
    expect(() => imageSize(input)).toThrow(`disabled file type: ${type}`);
  });
});
