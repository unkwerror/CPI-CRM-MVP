/** Small, dependency-free detector for the MIME families accepted by the MVP. */
export function detectMimeType(header: Uint8Array, declaredMimeType: string | null): string {
  const bytes = Buffer.from(header.buffer, header.byteOffset, header.byteLength);
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (
    bytes.subarray(0, 6).toString('ascii') === 'GIF87a' ||
    bytes.subarray(0, 6).toString('ascii') === 'GIF89a'
  ) {
    return 'image/gif';
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // OOXML files are ZIP containers; preserving an OOXML declaration is more useful
    // than reducing it to application/zip without unpacking untrusted input.
    return declaredMimeType?.startsWith('application/vnd.openxmlformats-officedocument')
      ? declaredMimeType
      : 'application/zip';
  }
  if (looksLikeUtf8Text(bytes))
    return declaredMimeType?.startsWith('text/') ? declaredMimeType : 'text/plain';
  return 'application/octet-stream';
}

function startsWith(buffer: Buffer, signature: readonly number[]): boolean {
  return signature.every((byte, index) => buffer[index] === byte);
}

function looksLikeUtf8Text(buffer: Buffer): boolean {
  if (buffer.length === 0 || buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}
