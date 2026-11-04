import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  GENDERS,
  GENDER_ERROR,
  MAX_PHOTO_BYTES,
  decideGenderEdit,
  isGender,
  parseGenderPatch,
  validateGender,
  validatePhotoFile,
} from "./profile.ts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const invalidGenders = [
  "Prefer not to say",
  "male",
  "MALE",
  "Female ",
  " Nonbinary",
  "",
  null,
  undefined,
  0,
  1,
  true,
  [],
  ["Male"],
  {},
  { value: "Male" },
];

describe("gender accepts exactly Male/Female", () => {
  it("publishes only the two selectable values", () => {
    assert.deepEqual([...GENDERS], ["Male", "Female"]);
  });

  it("accepts both values and rejects every other shape or spelling", () => {
    for (const value of ["Male", "Female"]) {
      assert.equal(isGender(value), true, value);
      assert.equal(validateGender(value), null, value);
    }

    for (const value of invalidGenders) {
      assert.equal(isGender(value), false, `isGender(${JSON.stringify(value)})`);
      assert.equal(
        validateGender(value),
        GENDER_ERROR,
        `validateGender(${JSON.stringify(value)})`,
      );
    }
  });
});

describe("PATCH gender semantics", () => {
  it("omits gender when the key is absent, preserving legacy NULL", () => {
    const patch = parseGenderPatch({ nickname: "maya" });
    assert.deepEqual(patch, { ok: true });
    assert.equal("gender" in patch, false);
  });

  it("does not treat an inherited property as an explicit gender", () => {
    const body = Object.create({ gender: "Male" }) as Record<string, unknown>;
    assert.deepEqual(parseGenderPatch(body), { ok: true });
  });

  it("returns an exact value when explicitly supplied", () => {
    assert.deepEqual(parseGenderPatch({ gender: "Male" }), {
      ok: true,
      gender: "Male",
    });
    assert.deepEqual(parseGenderPatch({ gender: "Female" }), {
      ok: true,
      gender: "Female",
    });
  });

  it("rejects null, empty, removed, and coerced values", () => {
    for (const value of invalidGenders) {
      assert.deepEqual(
        parseGenderPatch({ gender: value }),
        { ok: false, error: GENDER_ERROR },
        `parseGenderPatch({ gender: ${JSON.stringify(value)} })`,
      );
    }
  });
});

describe("profile edit gender semantics", () => {
  it("omits unchanged values, including a legacy NULL gender", () => {
    assert.deepEqual(decideGenderEdit("", ""), {
      action: "omit",
      error: null,
    });
    assert.deepEqual(decideGenderEdit("Male", "Male"), {
      action: "omit",
      error: null,
    });
    assert.deepEqual(decideGenderEdit("Female", "Female"), {
      action: "omit",
      error: null,
    });
  });

  it("sends only an explicit valid change", () => {
    assert.deepEqual(decideGenderEdit("", "Male"), {
      action: "set",
      value: "Male",
      error: null,
    });
    assert.deepEqual(decideGenderEdit("Male", "Female"), {
      action: "set",
      value: "Female",
      error: null,
    });
  });

  it("rejects clearing or replacing with an unsupported value", () => {
    assert.deepEqual(decideGenderEdit("Male", ""), {
      action: "invalid",
      error: GENDER_ERROR,
    });
    assert.deepEqual(decideGenderEdit("", "Prefer not to say"), {
      action: "invalid",
      error: GENDER_ERROR,
    });
    assert.deepEqual(decideGenderEdit("", "male"), {
      action: "invalid",
      error: GENDER_ERROR,
    });
  });
});

describe("gender wiring and public visibility", () => {
  it("requires onboarding gender and writes the validated value directly", async () => {
    const src = await read("../../app/api/onboarding/profile/route.ts");
    assert.match(src, /if \(!isGender\(gender\)\)/);
    assert.match(src, /\n\s+gender,\n\s+username:/);
    assert.doesNotMatch(src, /String\(gender\b/);
  });

  it("PATCH only writes gender when explicitly supplied", async () => {
    const src = await read("../../app/api/profile/route.ts");
    assert.match(src, /const genderPatch = parseGenderPatch\(body\)/);
    assert.match(src, /if \(genderPatch\.gender !== undefined\)/);
    assert.match(src, /update\.gender = genderPatch\.gender/);
    assert.doesNotMatch(src, /String\(gender\b/);
  });

  it("edit and onboarding disclose public visibility beside the selector", async () => {
    const [edit, onboarding] = await Promise.all([
      read("../../app/profile/edit/client.tsx"),
      read("../../app/onboarding/profile/form.tsx"),
    ]);

    assert.ok(edit.includes("decideGenderEdit"));
    assert.ok(edit.includes("Your gender is public"));
    assert.ok(onboarding.includes("GENDERS.map"));
    assert.ok(onboarding.includes("Your gender is public"));
  });

  it("search and public profiles intentionally render gender", async () => {
    const [search, publicProfile] = await Promise.all([
      read("../../app/api/search/route.ts"),
      read("../../app/u/[username]/page.tsx"),
    ]);

    assert.ok(search.includes("gender: r.gender"));
    assert.ok(publicProfile.includes("profile.gender"));
  });

  it("legacy NULL does not participate in onboarding completion", async () => {
    const state = await read("../onboarding/state.ts");
    assert.doesNotMatch(state, /gender/i);
  });
});

describe("photo validation restores base file behavior", () => {
  it("accepts a valid MIME file even without a filename extension", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "camera", {
      type: "image/jpeg",
    });

    assert.equal(validatePhotoFile(file), null);
  });

  it("keeps the base MIME, empty-file, and size limits", () => {
    assert.equal(
      validatePhotoFile(new File(["x"], "photo.gif", { type: "image/gif" })),
      "Use JPG, PNG or WEBP.",
    );
    assert.equal(
      validatePhotoFile(new File([], "empty.png", { type: "image/png" })),
      "Empty file.",
    );
    assert.equal(
      validatePhotoFile(
        new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], "big.jpg", {
          type: "image/jpeg",
        }),
      ),
      "Max 5 MB per photo.",
    );
  });
});
