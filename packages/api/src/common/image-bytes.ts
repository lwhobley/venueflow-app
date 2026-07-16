import { BadRequestException } from '@nestjs/common';

export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

/** Detect image MIME from magic bytes. Returns null when unrecognized. */
export function detectImageMime(data: Buffer): AllowedImageMime | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  // HEIC/HEIF: ISO BMFF with ftyp box and a heic/heif/mif1/msf1 brand.
  if (data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp') {
    const brand = data.toString('ascii', 8, 12);
    if (brand === 'heic' || brand === 'heif' || brand === 'mif1' || brand === 'msf1') {
      return 'image/heic';
    }
  }
  return null;
}

/**
 * Validate claimed MIME against magic bytes. Returns the detected (trusted) MIME.
 * Rejects mismatches and unrecognized payloads.
 */
export function assertAllowedImageBytes(
  data: Buffer,
  claimedMime?: string | null,
): AllowedImageMime {
  const detected = detectImageMime(data);
  if (!detected) {
    throw new BadRequestException('Unsupported image type. Use JPEG, PNG, WebP, or HEIC.');
  }
  if (claimedMime && claimedMime !== detected) {
    // Treat heif as interchangeable with heic for client labels.
    const claimedNorm = claimedMime === 'image/heif' ? 'image/heic' : claimedMime;
    if (claimedNorm !== detected) {
      throw new BadRequestException('Image content does not match the declared type.');
    }
  }
  return detected;
}
