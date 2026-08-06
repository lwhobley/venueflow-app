import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: vi.fn(),
  EncodingType: { Base64: 'base64' },
}));

import { base64FromDataUrl, readPickedFileText } from './picked-file';

describe('picked-file', () => {
  it('extracts base64 payloads without retaining the data URL header', () => {
    expect(base64FromDataUrl('data:text/plain;base64,SGVsbG8=')).toBe('SGVsbG8=');
  });

  it('rejects malformed data URLs', () => {
    expect(() => base64FromDataUrl('data:text/plain,hello')).toThrow('could not be encoded');
  });

  it('reads browser File/Blob text directly instead of treating its blob URI as a native path', async () => {
    const text = vi.fn().mockResolvedValue('name,email\nAda,ada@example.com');
    await expect(readPickedFileText({ uri: 'blob:test', file: { text } as unknown as Blob })).resolves.toContain('Ada');
    expect(text).toHaveBeenCalledOnce();
  });
});
