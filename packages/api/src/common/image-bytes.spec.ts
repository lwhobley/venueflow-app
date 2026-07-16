import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { assertAllowedImageBytes, detectImageMime } from './image-bytes';
import { unpaidBreakMs } from './break-duration';
import { htmlEscape } from './html-escape';

describe('detectImageMime', () => {
  it('detects jpeg', () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('detects png', () => {
    expect(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
  });

  it('rejects mismatch between claim and bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(() => assertAllowedImageBytes(jpeg, 'image/png')).toThrow(BadRequestException);
    expect(assertAllowedImageBytes(jpeg, 'image/jpeg')).toBe('image/jpeg');
  });
});

describe('unpaidBreakMs', () => {
  it('handles numeric and string timestamps', () => {
    expect(unpaidBreakMs(1000, 4000)).toBe(3000);
    expect(unpaidBreakMs('1000', '4000')).toBe(3000);
  });

  it('returns 0 for invalid or inverted ranges', () => {
    expect(unpaidBreakMs('not-a-date', 4000)).toBe(0);
    expect(unpaidBreakMs(5000, 1000)).toBe(0);
  });
});

describe('htmlEscape', () => {
  it('escapes HTML special characters', () => {
    expect(htmlEscape(`a<b>"c"&d`)).toBe('a&lt;b&gt;&quot;c&quot;&amp;d');
  });
});
