import { BadRequestException } from '@nestjs/common';
import { detectImageMime } from './image-bytes';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  txt: 'text/plain',
  csv: 'text/csv',
  rtf: 'application/rtf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const GENERIC_MIME = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
const ZIP_MIME = new Set([
  MIME_BY_EXTENSION.docx,
  MIME_BY_EXTENSION.xlsx,
  MIME_BY_EXTENSION.pptx,
]);
export function safeDocumentFileName(value: string): string {
  const leaf = value.split(/[\\/]/).pop()?.trim() ?? '';
  const cleaned = leaf.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '_').slice(0, 180);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new BadRequestException('A valid file name is required');
  }
  return cleaned;
}

export function assertAllowedDocumentBytes(data: Buffer, claimedMime: string, fileName: string): string {
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const trustedMime = MIME_BY_EXTENSION[extension];
  if (!trustedMime) {
    throw new BadRequestException('Unsupported file type. Use PDF, modern Office, image, text, CSV, or RTF files.');
  }

  const normalizedClaim = claimedMime.toLowerCase().trim();
  if (!GENERIC_MIME.has(normalizedClaim) && normalizedClaim !== trustedMime) {
    throw new BadRequestException('File content type does not match its extension');
  }

  if (trustedMime.startsWith('image/')) {
    if (detectImageMime(data) !== trustedMime) throw new BadRequestException('Image content does not match its extension');
  } else if (trustedMime === MIME_BY_EXTENSION.pdf) {
    if (data.subarray(0, 5).toString('ascii') !== '%PDF-') throw new BadRequestException('Invalid PDF file');
  } else if (ZIP_MIME.has(trustedMime)) {
    const signature = data.subarray(0, 4).toString('hex');
    if (!['504b0304', '504b0506', '504b0708'].includes(signature)) {
      throw new BadRequestException('Invalid Office document');
    }
  } else if (trustedMime === MIME_BY_EXTENSION.rtf) {
    if (!data.subarray(0, 5).toString('ascii').startsWith('{\\rtf')) throw new BadRequestException('Invalid RTF file');
  } else if (data.includes(0)) {
    throw new BadRequestException('Text documents cannot contain binary data');
  }

  return trustedMime;
}
