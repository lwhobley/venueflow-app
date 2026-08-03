import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertAllowedDocumentBytes, safeDocumentFileName } from './document-bytes';

describe('document byte validation', () => {
  it('accepts a PDF and trusts the extension-derived MIME', () => {
    expect(assertAllowedDocumentBytes(Buffer.from('%PDF-1.7\n'), 'application/octet-stream', 'manual.pdf')).toBe('application/pdf');
  });

  it('accepts modern Office ZIP containers', () => {
    expect(assertAllowedDocumentBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'application/octet-stream', 'recipes.docx'))
      .toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('rejects dangerous and mismatched file types', () => {
    expect(() => assertAllowedDocumentBytes(Buffer.from('<html>'), 'text/html', 'page.html')).toThrow(BadRequestException);
    expect(() => assertAllowedDocumentBytes(Buffer.from('not a pdf'), 'application/pdf', 'manual.pdf')).toThrow(BadRequestException);
  });

  it('removes path components and unsafe header characters from names', () => {
    expect(safeDocumentFileName('../menu?.pdf')).toBe('menu_.pdf');
  });
});
