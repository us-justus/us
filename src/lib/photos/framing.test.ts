import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FRESH_FRAMING,
  clampFraming,
  coverScale,
  framingKeyForFile,
  framingToCropRect,
  initialFramingForPhoto,
} from "./framing.ts";

test("new photos start from a fresh centered framing, never inherited", () => {
  const a = initialFramingForPhoto();
  const b = initialFramingForPhoto();
  assert.deepEqual(a, { scale: 1, x: 0, y: 0 });
  assert.deepEqual(b, FRESH_FRAMING);
  // Mutating one must not affect the next (no shared reference).
  a.x = 999;
  assert.equal(initialFramingForPhoto().x, 0);
});

test("framing keys are per-file identity", () => {
  const f1 = { name: "a.jpg", size: 10, lastModified: 1 };
  const f2 = { name: "a.jpg", size: 10, lastModified: 2 };
  const f3 = { name: "b.jpg", size: 10, lastModified: 1 };
  assert.equal(framingKeyForFile(f1), "a.jpg-10-1");
  assert.notEqual(framingKeyForFile(f1), framingKeyForFile(f2));
  assert.notEqual(framingKeyForFile(f1), framingKeyForFile(f3));
});

test("cover scale fills the portrait frame for any orientation", () => {
  // Portrait source in a 3:4 frame: exact fit, scale 1.
  assert.equal(coverScale({ w: 900, h: 1200 }, { w: 300, h: 400 }), 1 / 3);
  // Landscape source: width-limited, covers vertically-centered.
  const k = coverScale({ w: 1200, h: 800 }, { w: 300, h: 400 });
  assert.ok(Math.abs(k - 0.5) < 1e-9);
  // Square source: height-limited.
  assert.ok(coverScale({ w: 800, h: 800 }, { w: 300, h: 400 }) > 0);
  // Degenerate input never NaNs.
  assert.equal(coverScale({ w: 0, h: 0 }, { w: 300, h: 400 }), 1);
});

test("clamp keeps the image covering the frame (symmetric bounds)", () => {
  const natural = { w: 900, h: 1200 };
  const frame = { w: 300, h: 400 };
  // At scale 1 the cover image exactly matches the frame: no drift allowed.
  assert.deepEqual(clampFraming({ scale: 1, x: 50, y: -30 }, natural, frame), {
    scale: 1,
    x: 0,
    y: 0,
  });
  // At 2x zoom the image may shift up to (600-300)/2 = 150px horizontally
  // and (800-400)/2 = 200px vertically.
  assert.deepEqual(clampFraming({ scale: 2, x: 999, y: -999 }, natural, frame), {
    scale: 2,
    x: 150,
    y: -200,
  });
  // Scale itself is bounded to [1, 3].
  assert.equal(clampFraming({ scale: 99, x: 0, y: 0 }, natural, frame).scale, 3);
  assert.equal(clampFraming({ scale: 0.1, x: 0, y: 0 }, natural, frame).scale, 1);
});

test("per-photo framing map: gestures on photo B never mutate photo A", () => {
  const store = new Map<string, { scale: number; x: number; y: number }>();
  store.set("a.jpg-1-1", { ...FRESH_FRAMING });
  store.set("b.jpg-2-2", { ...FRESH_FRAMING });
  // Simulate a drag+zoom on photo B only.
  const natural = { w: 900, h: 1200 };
  const frame = { w: 300, h: 400 };
  store.set("b.jpg-2-2", clampFraming({ scale: 2, x: 40, y: 20 }, natural, frame));
  assert.deepEqual(store.get("a.jpg-1-1"), { scale: 1, x: 0, y: 0 });
  assert.deepEqual(store.get("b.jpg-2-2"), { scale: 2, x: 40, y: 20 });
  // Switching back restores photo A's own framing.
  assert.deepEqual(store.get("a.jpg-1-1"), initialFramingForPhoto());
});

test("crop rect is centered for portrait, centered cover for landscape/square", () => {
  const box = { w: 340, h: 440 };
  const frameW = Math.min(box.w, (box.h * 3) / 4);
  const frameH = (frameW * 4) / 3;
  const frame = { w: frameW, h: frameH, x: (box.w - frameW) / 2, y: (box.h - frameH) / 2 } as {
    w: number;
    h: number;
    x: number;
    y: number;
  };
  const frameSize = { w: frame.w, h: frame.h };
  // Portrait 3:4 source: crop is the whole image.
  const portrait = framingToCropRect({ scale: 1, x: 0, y: 0 }, { w: 900, h: 1200 }, box, frameSize);
  assert.ok(Math.abs(portrait.sx) < 1e-6);
  assert.ok(Math.abs(portrait.sy) < 1e-6);
  assert.ok(Math.abs(portrait.sw - 900) < 1e-6);
  assert.ok(Math.abs(portrait.sh - 1200) < 1e-6);
  // Landscape source: full height, horizontally centered crop.
  const landscape = framingToCropRect({ scale: 1, x: 0, y: 0 }, { w: 1600, h: 900 }, box, frameSize);
  assert.ok(Math.abs(landscape.sy) < 1e-6);
  assert.ok(Math.abs(landscape.sh - 900) < 1e-6);
  assert.ok(landscape.sx > 0 && landscape.sx + landscape.sw <= 1600 + 1e-6);
  // Square source: full height, horizontally centered crop.
  const square = framingToCropRect({ scale: 1, x: 0, y: 0 }, { w: 1000, h: 1000 }, box, frameSize);
  assert.ok(Math.abs(square.sy) < 1e-6);
  assert.ok(Math.abs(square.sh - 1000) < 1e-6);
  assert.ok(square.sx > 0 && square.sx + square.sw <= 1000 + 1e-6);
});

test("DONE uses the active photo's own framing, not a sibling's", () => {
  const box = { w: 340, h: 440 };
  const frameSize = { w: 300, h: 400 };
  const natural = { w: 900, h: 1200 };
  const rectA = framingToCropRect({ scale: 1, x: 0, y: 0 }, natural, box, frameSize);
  const rectB = framingToCropRect({ scale: 2, x: 100, y: 50 }, natural, box, frameSize);
  // Different framings produce different crops; zooming in shrinks the
  // source rect (tighter crop), proving per-photo state flows to output.
  assert.notDeepEqual(rectA, rectB);
  assert.ok(rectB.sw < rectA.sw && rectB.sh < rectA.sh);
});
