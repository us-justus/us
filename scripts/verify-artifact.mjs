#!/usr/bin/env node
// Dependency-free ZIP inspector for the privileged staging deploy.
//
// The candidate artifact is DATA produced by an unprivileged workflow. Before
// anything is extracted, this reads the ZIP central directory and refuses
// archives that could escape the extraction directory or exhaust the runner:
//
//   - symbolic links (detected from the Unix file mode in external attributes)
//   - special files (FIFO, socket, block/character device)
//   - absolute paths, drive-letter paths, backslashes, `..`/`.` segments
//   - duplicate member names
//   - encrypted members and unsupported compression methods
//   - oversized archives (compressed, uncompressed, per-entry, member count)
//   - malformed metadata (EOCD, central directory, local headers, ZIP64)
//
// Every rule fails closed: if the metadata cannot be understood, the artifact
// is rejected rather than extracted. The archive is only unpacked after this
// script exits 0.
//
// Usage: node scripts/verify-artifact.mjs <artifact.zip>
// Exit 0 = validated. Exit 1 = rejected (GitHub ::error:: lines). Exit 2 = usage.

import { readFileSync, statSync } from "node:fs";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const MAX_COMMENT = 0xffff;

// Generous for a Next.js/OpenNext bundle, small enough that a malicious
// artifact cannot exhaust the runner's disk or memory. Raise deliberately.
export const ZIP_LIMITS = Object.freeze({
  maxArchiveBytes: 512 * 1024 * 1024,
  maxTotalCompressedBytes: 512 * 1024 * 1024,
  maxTotalUncompressedBytes: 1024 * 1024 * 1024,
  maxEntryUncompressedBytes: 256 * 1024 * 1024,
  maxEntries: 100_000,
});

const ALLOWED_METHODS = new Set([0, 8]); // stored, deflate
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_SYMLINK = 0xa000;
const UNIX_SPECIAL_TYPES = new Set([0x1000, 0x2000, 0x6000, 0xc000]);

export class ZipFormatError extends Error {}

function fail(message) {
  throw new ZipFormatError(message);
}

function requireRange(buffer, offset, length, limit, what) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 0) {
    fail(`${what} has an invalid offset or length`);
  }
  if (offset + length > limit) fail(`${what} is out of bounds`);
}

function readName(buffer, offset, length) {
  const bytes = buffer.subarray(offset, offset + length);
  let name;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("member name is not valid UTF-8");
  }
  if (name.includes("\0") || name.includes("\n") || name.includes("\r")) {
    fail("member name contains a control character");
  }
  return name;
}

/**
 * Read the IDs of an extra-field block. The Info-ZIP Unicode Path field
 * (0x7075) can override the member name that was just validated, so callers
 * reject it explicitly.
 */
function readExtraFieldIds(buffer, offset, length, what) {
  const ids = [];
  const end = offset + length;
  let cursor = offset;
  while (cursor < end) {
    if (cursor + 4 > end) fail(`${what} has a truncated extra field`);
    const id = buffer.readUInt16LE(cursor);
    const size = buffer.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + size > end) fail(`${what} has a truncated extra field`);
    ids.push(id);
    cursor += size;
  }
  return ids;
}

/**
 * Locate the End Of Central Directory record. A ZIP comment may contain the
 * signature, so only an EOCD whose declared comment reaches exactly the end of
 * the file is accepted. Anything else is treated as malformed.
 */
function findEndOfCentralDirectory(buffer) {
  if (buffer.length < EOCD_SIZE) fail("file is too small to be a ZIP archive");
  const earliest = Math.max(0, buffer.length - EOCD_SIZE - MAX_COMMENT);
  for (let offset = buffer.length - EOCD_SIZE; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + EOCD_SIZE + commentLength === buffer.length) return offset;
  }
  fail("no End Of Central Directory record was found");
}

/**
 * Parse the central directory. Throws ZipFormatError on anything ambiguous;
 * callers turn that into a fail-closed validation error.
 */
export function readZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer)) fail("artifact is not a Buffer");

  const eocdOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    fail("multi-disk archives are not supported");
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    fail("ZIP64 archives are not supported");
  }
  if (totalEntries === 0) fail("archive contains no entries");

  requireRange(buffer, centralOffset, centralSize, eocdOffset, "central directory");
  if (centralOffset + centralSize !== eocdOffset) {
    fail("central directory does not end at the End Of Central Directory record");
  }

  const entries = [];
  const seen = new Set();
  let cursor = centralOffset;
  const centralEnd = centralOffset + centralSize;

  for (let index = 0; index < totalEntries; index += 1) {
    requireRange(buffer, cursor, CENTRAL_HEADER_SIZE, centralEnd, `central directory entry ${index}`);
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      fail(`central directory entry ${index} has an invalid signature`);
    }

    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      fail("ZIP64 entries are not supported");
    }
    if (nameLength === 0) fail(`central directory entry ${index} has an empty name`);

    const variableLength = nameLength + extraLength + commentLength;
    requireRange(buffer, cursor + CENTRAL_HEADER_SIZE, variableLength, centralEnd, `central directory entry ${index}`);
    const nameBytes = buffer.subarray(cursor + CENTRAL_HEADER_SIZE, cursor + CENTRAL_HEADER_SIZE + nameLength);
    const name = readName(buffer, cursor + CENTRAL_HEADER_SIZE, nameLength);
    const centralExtraOffset = cursor + CENTRAL_HEADER_SIZE + nameLength;
    const centralExtraIds = readExtraFieldIds(
      buffer,
      centralExtraOffset,
      extraLength,
      `central directory entry ${index}`,
    );
    if (centralExtraIds.includes(0x7075)) {
      fail(`central directory entry ${index} uses a Unicode path extra field that could override its validated name`);
    }

    if (seen.has(name)) fail(`duplicate member name ${JSON.stringify(name)}`);
    seen.add(name);

    // The local header must exist, agree with the central directory and end
    // before the central directory starts.
    requireRange(buffer, localOffset, LOCAL_HEADER_SIZE, centralOffset, `local header for ${JSON.stringify(name)}`);
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      fail(`local header for ${JSON.stringify(name)} has an invalid signature`);
    }
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    if (localFlags !== flags || localMethod !== method) {
      fail(`local header for ${JSON.stringify(name)} disagrees with the central directory`);
    }
    requireRange(
      buffer,
      localOffset + LOCAL_HEADER_SIZE,
      localNameLength + localExtraLength + compressedSize,
      centralOffset,
      `data for ${JSON.stringify(name)}`,
    );
    const localName = buffer.subarray(
      localOffset + LOCAL_HEADER_SIZE,
      localOffset + LOCAL_HEADER_SIZE + localNameLength,
    );
    if (!localName.equals(nameBytes)) {
      fail(`local header name for ${JSON.stringify(name)} disagrees with the central directory`);
    }
    const localExtraIds = readExtraFieldIds(
      buffer,
      localOffset + LOCAL_HEADER_SIZE + localNameLength,
      localExtraLength,
      `local header for ${JSON.stringify(name)}`,
    );
    if (localExtraIds.includes(0x7075)) {
      fail(`local header for ${JSON.stringify(name)} uses a Unicode path extra field that could override its validated name`);
    }
    // With a data descriptor (flag 0x0008) the local sizes may be zero, so they
    // are only compared when the descriptor is absent.
    if ((flags & 0x0008) === 0) {
      const localCompressed = buffer.readUInt32LE(localOffset + 18);
      const localUncompressed = buffer.readUInt32LE(localOffset + 22);
      if (localCompressed !== compressedSize || localUncompressed !== uncompressedSize) {
        fail(`local sizes for ${JSON.stringify(name)} disagree with the central directory`);
      }
    }

    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const fileType = unixMode & UNIX_FILE_TYPE_MASK;

    entries.push({
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      fileType,
    });

    cursor += CENTRAL_HEADER_SIZE + variableLength;
  }

  if (cursor !== centralEnd) fail("central directory size does not match its entries");

  return { entries };
}

function validatePath(name) {
  const errors = [];
  if (name.startsWith("/")) errors.push(`absolute path ${JSON.stringify(name)}`);
  if (/^[A-Za-z]:/.test(name)) errors.push(`drive-letter path ${JSON.stringify(name)}`);
  if (name.includes("\\")) errors.push(`backslash path ${JSON.stringify(name)}`);
  const isDirectory = name.endsWith("/");
  const segments = (isDirectory ? name.slice(0, -1) : name).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    errors.push(`non-canonical path ${JSON.stringify(name)}`);
  }
  return errors;
}

/**
 * Validate an archive buffer. Returns an array of human-readable errors; an
 * empty array means every rule held.
 */
export function validateZip(buffer, limits = ZIP_LIMITS) {
  const effective = { ...ZIP_LIMITS, ...limits };
  const errors = [];

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return ["artifact is empty"];
  if (buffer.length > effective.maxArchiveBytes) {
    return [
      `artifact is ${buffer.length} bytes, above the ${effective.maxArchiveBytes}-byte compressed limit`,
    ];
  }

  let archive;
  try {
    archive = readZipEntries(buffer);
  } catch (error) {
    if (error instanceof ZipFormatError) return [`ZIP metadata could not be validated: ${error.message}`];
    throw error;
  }

  if (archive.entries.length > effective.maxEntries) {
    errors.push(`artifact has ${archive.entries.length} entries, above the ${effective.maxEntries}-entry limit`);
  }

  let totalCompressed = 0;
  let totalUncompressed = 0;

  for (const entry of archive.entries) {
    totalCompressed += entry.compressedSize;
    totalUncompressed += entry.uncompressedSize;

    const label = JSON.stringify(entry.name);
    errors.push(...validatePath(entry.name));

    // The Unix mode lives in the external attributes regardless of the
    // declared platform, so a non-Unix archive cannot smuggle one either.
    if (entry.fileType === UNIX_SYMLINK) {
      errors.push(`symbolic link ${label}`);
    } else if (UNIX_SPECIAL_TYPES.has(entry.fileType)) {
      errors.push(`special file ${label}`);
    }

    if ((entry.flags & 0x0001) !== 0 || (entry.flags & 0x0040) !== 0) {
      errors.push(`encrypted member ${label}`);
    }
    if ((entry.flags & 0x2000) !== 0) {
      errors.push(`masked local header ${label}`);
    }
    if (!ALLOWED_METHODS.has(entry.method)) {
      errors.push(`unsupported compression method ${entry.method} for ${label}`);
    }
    if (entry.uncompressedSize > effective.maxEntryUncompressedBytes) {
      errors.push(
        `member ${label} expands to ${entry.uncompressedSize} bytes, above the ${effective.maxEntryUncompressedBytes}-byte limit`,
      );
    }
    if (entry.compressedSize > effective.maxTotalCompressedBytes) {
      errors.push(`member ${label} is larger than the compressed artifact limit`);
    }
  }

  if (totalCompressed > effective.maxTotalCompressedBytes) {
    errors.push(
      `compressed members total ${totalCompressed} bytes, above the ${effective.maxTotalCompressedBytes}-byte limit`,
    );
  }
  if (totalUncompressed > effective.maxTotalUncompressedBytes) {
    errors.push(
      `uncompressed members total ${totalUncompressed} bytes, above the ${effective.maxTotalUncompressedBytes}-byte limit`,
    );
  }

  return errors;
}

function main(argv) {
  const path = argv[0];
  if (!path) {
    console.error("usage: verify-artifact.mjs <artifact.zip>");
    return 2;
  }

  let size;
  try {
    size = statSync(path).size;
  } catch (error) {
    console.error(`::error::cannot stat ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (size > ZIP_LIMITS.maxArchiveBytes) {
    console.error(
      `::error::artifact is ${size} bytes, above the ${ZIP_LIMITS.maxArchiveBytes}-byte compressed limit`,
    );
    return 1;
  }

  let buffer;
  try {
    buffer = readFileSync(path);
  } catch (error) {
    console.error(`::error::cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const errors = validateZip(buffer);
  if (errors.length > 0) {
    for (const error of errors) console.error(`::error::${error}`);
    return 1;
  }

  const entries = readZipEntries(buffer).entries;
  const uncompressed = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  console.log(`OK: ${entries.length} ZIP members, ${uncompressed} uncompressed bytes, no unsafe entries`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
