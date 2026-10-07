export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

function hasJpegStructure(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return false;
  let offset = 2;
  let hasFrame = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) return hasFrame;
    if (marker === 0xda) {
      if (offset + 2 > bytes.length) return false;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      return hasFrame && length >= 6 && offset + length < bytes.length - 2;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length - 2) return false;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 8 || (bytes[offset + 3] === 0 && bytes[offset + 4] === 0) || (bytes[offset + 5] === 0 && bytes[offset + 6] === 0)) return false;
      hasFrame = true;
    }
    offset += length;
  }
  return false;
}

function hasPngStructure(bytes: Uint8Array): boolean {
  if (bytes.length < 45 || bytes[0] !== 0x89 || String.fromCharCode(...bytes.subarray(1, 4)) !== "PNG" || bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a) return false;
  let offset = 8;
  let hasHeader = false;
  let hasData = false;
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
    if (length > bytes.length || offset + 12 + length > bytes.length) return false;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!hasHeader && (type !== "IHDR" || length !== 13)) return false;
    if (type === "IHDR") {
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, 8);
      if (hasHeader || length !== 13 || view.getUint32(0, false) === 0 || view.getUint32(4, false) === 0) return false;
      hasHeader = true;
    } else if (type === "IDAT") hasData = true;
    else if (type === "IEND") return length === 0 && hasHeader && hasData && offset + 12 === bytes.length;
    offset += 12 + length;
  }
  return false;
}

function hasWebpStructure(bytes: Uint8Array): boolean {
  if (bytes.length < 20 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP") return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  if (riffSize !== bytes.length - 8) return false;
  let offset = 12;
  let hasImageChunk = false;
  while (offset + 8 <= bytes.length) {
    const tag = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    if (length === 0 || offset + 8 + length > bytes.length) return false;
    if (tag === "VP8 " || tag === "VP8L" || tag === "VP8X") hasImageChunk = true;
    offset += 8 + length + (length % 2);
  }
  return hasImageChunk && offset === bytes.length;
}

/** Detect the supported raster formats from bytes, never the client MIME. */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (hasJpegStructure(bytes)) return "image/jpeg";
  if (hasPngStructure(bytes)) return "image/png";
  if (hasWebpStructure(bytes)) return "image/webp";
  return null;
}
