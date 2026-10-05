import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideUsnMutation, isDuplicateUsnError } from "./usn-mutation.ts";

describe("decideUsnMutation", () => {
  it("upserts for a new anonymous user with no profile yet", () => {
    assert.deepEqual(
      decideUsnMutation({ hasProfile: false, storedUsn: "", submittedUsn: "2BU23CS025" }),
      { action: "upsert" },
    );
  });

  it("is idempotent when the same UID retries its own USN", () => {
    assert.deepEqual(
      decideUsnMutation({ hasProfile: true, storedUsn: "2BU23CS025", submittedUsn: "2BU23CS025" }),
      { action: "ok-idempotent" },
    );
  });

  it("rejects a USN change once a profile exists", () => {
    assert.deepEqual(
      decideUsnMutation({ hasProfile: true, storedUsn: "2BU23CS025", submittedUsn: "2BU23CS026" }),
      { action: "reject-immutable" },
    );
  });

  it("rejects when a profile exists but no USN is stored", () => {
    assert.deepEqual(
      decideUsnMutation({ hasProfile: true, storedUsn: "", submittedUsn: "2BU23CS025" }),
      { action: "reject-immutable" },
    );
  });

  it("never reports a duplicate for a same-UID retry path", () => {
    // The duplicate/23505 branch is only reachable via the upsert path, i.e.
    // a UID with no profile claiming an already-owned USN — a UID mismatch,
    // never a same-UID retry (which short-circuits to ok-idempotent above).
    const d = decideUsnMutation({ hasProfile: true, storedUsn: "2BU23CS025", submittedUsn: "2BU23CS025" });
    assert.notEqual(d.action, "upsert");
  });
});

describe("isDuplicateUsnError", () => {
  it("matches the Postgres unique-violation code", () => {
    assert.equal(isDuplicateUsnError({ code: "23505", message: "duplicate key value" }), true);
  });

  it("matches duplicate messages case-insensitively", () => {
    assert.equal(isDuplicateUsnError({ message: "Duplicate entry '2BU23CS025'" }), true);
  });

  it("rejects unrelated errors and empty input", () => {
    assert.equal(isDuplicateUsnError({ code: "42501", message: "permission denied" }), false);
    assert.equal(isDuplicateUsnError({ code: "23505x", message: "other" }), false);
    assert.equal(isDuplicateUsnError(null), false);
    assert.equal(isDuplicateUsnError(undefined), false);
  });
});
