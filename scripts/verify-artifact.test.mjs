// Regression tests for the staging artifact ZIP guard.
//
//   node --test scripts/verify-artifact.test.mjs
//
// Archives are built in memory, so every case is deterministic and no external
// `zip` binary is required.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ZIP_LIMITS, readZipEntries, validateZip } from "./verify-artifact.mjs";

const CLI = fileURLToPath(new URL("./verify-artifact.mjs", import.meta.url));

/** Encode one ZIP extra-field block (header + payload). */
function extraField(id, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(id, 0);
  header.writeUInt16LE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

/**
 * Build a minimal, spec-shaped ZIP. Only the fields the validator reads are
 * populated; CRC values are left at zero because nothing decompresses here.
 */
function buildZip(entries, options = {}) {
  const localChunks = [];
  const centralChunks = [];
  const localOffsets = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data ?? Buffer.alloc(0);
    const stored = entry.stored ?? data;
    const flags = entry.flags ?? 0;
    const method = entry.method ?? 0;
    const compressedSize = entry.compressedSize ?? stored.length;
    const uncompressedSize = entry.uncompressedSize ?? data.length;
    const versionMadeBy = entry.versionMadeBy ?? (((entry.platform ?? 3) << 8) | 20);
    const externalAttributes =
      entry.externalAttributes ?? (((entry.mode ?? 0o100644) & 0xffff) << 16) >>> 0;
    const localExtra = entry.localExtra ?? Buffer.alloc(0);
    const centralExtra = entry.extra ?? Buffer.alloc(0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(localExtra.length, 28);

    localOffsets.push(offset);
    const localHeader = Buffer.concat([local, name, localExtra, stored]);
    localChunks.push(localHeader);
    offset += localHeader.length;

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(versionMadeBy, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(centralExtra.length, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(externalAttributes, 38);
    central.writeUInt32LE(offset - localHeader.length, 42);
    centralChunks.push(Buffer.concat([central, name, centralExtra]));
  }

  const localData = Buffer.concat(localChunks);
  const centralDirectory = Buffer.concat(centralChunks);
  const comment = Buffer.from(options.comment ?? "", "utf8");
  const count = options.entryCountOverride ?? entries.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(options.centralOffsetOverride ?? localData.length, 16);
  eocd.writeUInt16LE(comment.length, 20);

  return {
    buffer: Buffer.concat([localData, centralDirectory, eocd, comment]),
    centralOffset: localData.length,
    localOffsets,
  };
}

function errorsFor(entries, limits) {
  return validateZip(buildZip(entries).buffer, limits).join("\n");
}

const regular = { name: "candidate.json", data: Buffer.from("{}"), mode: 0o100644 };

test("a normal artifact passes", () => {
  const zip = buildZip([
    regular,
    { name: ".open-next/worker.js", data: Buffer.from("export default {}"), mode: 0o100644 },
    { name: ".open-next/assets/", data: Buffer.alloc(0), mode: 0o040755 },
    { name: ".open-next/assets/_next/static/chunk.js", data: Buffer.from("chunk"), mode: 0o100644 },
  ]).buffer;

  assert.deepEqual(validateZip(zip), []);
  assert.equal(readZipEntries(zip).entries.length, 4);
});

test("symbolic links are rejected from the Unix file mode", () => {
  const errors = errorsFor([{ name: "worker.js", data: Buffer.from("/etc/passwd"), mode: 0o120777 }]);
  assert.match(errors, /symbolic link/);

  // The mode is read even when the platform byte is not Unix.
  const smuggled = errorsFor([
    {
      name: "worker.js",
      data: Buffer.from("/etc/passwd"),
      platform: 0,
      externalAttributes: (0o120777 << 16) >>> 0,
    },
  ]);
  assert.match(smuggled, /symbolic link/);
});

test("special files are rejected", () => {
  for (const mode of [0o010644, 0o020644, 0o060644, 0o140644]) {
    assert.match(
      errorsFor([{ name: "device", data: Buffer.alloc(0), mode }]),
      /special file/,
      `mode ${mode.toString(8)} should be rejected`,
    );
  }
});

test("path traversal is rejected", () => {
  for (const name of ["../evil", "a/../../evil", "a/../b", "./candidate.json", "a/./b"]) {
    assert.match(
      errorsFor([{ name, data: Buffer.from("x"), mode: 0o100644 }]),
      /non-canonical path/,
      `${name} should be rejected`,
    );
  }
});

test("absolute paths are rejected", () => {
  for (const name of ["/etc/passwd", "C:/windows/system32", "C:evil", "//server/share"]) {
    const errors = errorsFor([{ name, data: Buffer.from("x"), mode: 0o100644 }]);
    assert.match(errors, /(absolute|drive-letter|non-canonical) path/, `${name} should be rejected`);
  }
});

test("backslash paths are rejected", () => {
  assert.match(
    errorsFor([{ name: "a\\..\\evil", data: Buffer.from("x"), mode: 0o100644 }]),
    /backslash path/,
  );
});

test("duplicate member names are rejected", () => {
  assert.match(
    errorsFor([
      { name: "candidate.json", data: Buffer.from("{}"), mode: 0o100644 },
      { name: "candidate.json", data: Buffer.from("{}"), mode: 0o100644 },
    ]),
    /duplicate member name/,
  );
});

test("Unicode path extra fields are rejected", () => {
  const unicodePath = extraField(0x7075, Buffer.from([1, 0, 0, 0, 0x2f, 0x65, 0x74, 0x63]));

  assert.match(
    errorsFor([{ ...regular, extra: unicodePath }]),
    /Unicode path extra field/,
    "a central-directory 0x7075 field can override the validated name",
  );
  assert.match(
    errorsFor([{ ...regular, localExtra: unicodePath }]),
    /Unicode path extra field/,
    "a local-header 0x7075 field can override the validated name",
  );

  // Other extra fields are still allowed.
  assert.deepEqual(
    validateZip(
      buildZip([{ ...regular, extra: extraField(0x5455), localExtra: extraField(0x5455) }]).buffer,
    ),
    [],
  );
});

test("oversized archives are rejected", () => {
  const entries = [
    { name: "a", data: Buffer.alloc(6, 1), mode: 0o100644 },
    { name: "b", data: Buffer.alloc(6, 2), mode: 0o100644 },
  ];

  assert.match(errorsFor(entries, { maxTotalUncompressedBytes: 10 }), /uncompressed members total/);
  assert.match(errorsFor(entries, { maxEntryUncompressedBytes: 5 }), /expands to 6 bytes/);
  assert.match(errorsFor(entries, { maxTotalCompressedBytes: 5 }), /compressed members total/);
  assert.match(errorsFor(entries, { maxArchiveBytes: 10 }), /above the 10-byte compressed limit/);
  assert.match(errorsFor(entries, { maxEntries: 1 }), /above the 1-entry limit/);

  const archive = buildZip(entries).buffer;
  assert.ok(archive.length > 10);
  assert.deepEqual(validateZip(archive, { maxArchiveBytes: archive.length }), []);
});

test("encrypted and masked members are rejected", () => {
  assert.match(errorsFor([{ ...regular, flags: 0x0001 }]), /encrypted member/);
  assert.match(errorsFor([{ ...regular, flags: 0x2000 }]), /masked local header/);
});

test("unsupported compression methods are rejected", () => {
  assert.match(errorsFor([{ ...regular, method: 99 }]), /unsupported compression method 99/);
});

test("malformed metadata fails closed", () => {
  const valid = buildZip([regular]).buffer;

  assert.match(validateZip(valid.subarray(0, valid.length - 5)).join("\n"), /could not be validated/);

  const badCentral = Buffer.from(valid);
  badCentral.writeUInt32LE(0xdeadbeef, buildZip([regular]).centralOffset);
  assert.match(validateZip(badCentral).join("\n"), /invalid signature/);

  const badLocal = Buffer.from(valid);
  badLocal.writeUInt32LE(0xdeadbeef, 0);
  assert.match(validateZip(badLocal).join("\n"), /invalid signature/);

  const wrongCount = buildZip([regular], { entryCountOverride: 2 }).buffer;
  assert.match(validateZip(wrongCount).join("\n"), /could not be validated/);

  const wrongCentralOffset = buildZip([regular], { centralOffsetOverride: 4 }).buffer;
  assert.match(validateZip(wrongCentralOffset).join("\n"), /could not be validated/);

  assert.match(validateZip(Buffer.alloc(0)).join("\n"), /artifact is empty/);
});

test("ZIP64 archives fail closed", () => {
  const zip = buildZip([regular], { entryCountOverride: 0xffff }).buffer;
  assert.match(validateZip(zip).join("\n"), /ZIP64 archives are not supported/);
});

test("the CLI validates a real file and rejects a symlink archive", () => {
  const dir = mkdtempSync(join(tmpdir(), "us-artifact-"));
  try {
    const good = join(dir, "good.zip");
    writeFileSync(good, buildZip([regular]).buffer);
    const ok = spawnSync(process.execPath, [CLI, good], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /OK: 1 ZIP members/);

    const bad = join(dir, "bad.zip");
    writeFileSync(bad, buildZip([{ name: "evil", data: Buffer.from("x"), mode: 0o120777 }]).buffer);
    const rejected = spawnSync(process.execPath, [CLI, bad], { encoding: "utf8" });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /::error::symbolic link/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the default limits are present and sane", () => {
  assert.ok(ZIP_LIMITS.maxArchiveBytes >= 64 * 1024 * 1024);
  assert.ok(ZIP_LIMITS.maxTotalUncompressedBytes >= ZIP_LIMITS.maxArchiveBytes);
  assert.ok(ZIP_LIMITS.maxEntryUncompressedBytes > 0);
  assert.ok(ZIP_LIMITS.maxEntries > 1000);
});
