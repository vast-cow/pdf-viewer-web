import assert from "node:assert/strict";
import test from "node:test";
import { invertLightness } from "../src/viewer/lightness.ts";

function invert(values: number[]): number[] {
  const pixels = new Uint8ClampedArray(values);
  invertLightness(pixels);
  return Array.from(pixels);
}

test("white and black exchange, and neutral grays stay neutral", () => {
  for (const level of [0, 1, 37, 127, 128, 218, 254, 255]) {
    const inverted = 255 - level;
    assert.deepEqual(invert([level, level, level, 255]), [inverted, inverted, inverted, 255]);
  }
});

test("primary and secondary colors at midpoint lightness stay identical", () => {
  for (const rgb of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255]]) {
    assert.deepEqual(invert([...rgb, 255]), [...rgb, 255]);
  }
});

test("alpha is unchanged, including at zero opacity", () => {
  assert.deepEqual(invert([51, 102, 153, 119, 200, 128, 64, 0]), [102, 153, 204, 119, 191, 119, 55, 0]);
});

test("colors near black, white and the saturation boundary preserve their channel differences", () => {
  assert.deepEqual(invert([1, 0, 0, 255]), [255, 254, 254, 255]);
  assert.deepEqual(invert([254, 255, 255, 255]), [0, 1, 1, 255]);
  assert.deepEqual(invert([254, 126, 0, 255]), [255, 127, 1, 255]);
  assert.deepEqual(invert([255, 126, 1, 255]), [254, 125, 0, 255]);
});

function toHsl(red: number, green: number, blue: number): [number, number, number] {
  const [r, g, b] = [red / 255, green / 255, blue / 255];
  const high = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const chroma = high - low;
  const lightness = (high + low) / 2;
  if (!chroma) return [0, 0, lightness];
  const saturation = chroma / (1 - Math.abs(2 * lightness - 1));
  const sector = high === r ? (g - b) / chroma : high === g ? 2 + (b - r) / chroma : 4 + (r - g) / chroma;
  return [(sector / 6 + 1) % 1, saturation, lightness];
}

function toRgb(hue: number, saturation: number, lightness: number) {
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  return [0, 8, 4].map(offset => {
    const position = (offset + hue * 12) % 12;
    const channel = lightness - amplitude * Math.max(-1, Math.min(position - 3, 9 - position, 1));
    return Math.max(0, Math.min(255, Math.round(255 * channel)));
  });
}

test("the integer transform matches HSL conversion and round-trips exactly", () => {
  let random = 123456789;
  const nextByte = () => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return random >>> 24;
  };

  for (let index = 0; index < 10_000; index++) {
    const rgba = [nextByte(), nextByte(), nextByte(), nextByte()] as const;
    const [hue, saturation, lightness] = toHsl(rgba[0], rgba[1], rgba[2]);
    const result = invert([...rgba]);
    assert.deepEqual(result, [...toRgb(hue, saturation, 1 - lightness), rgba[3]]);
    const [newHue, newSaturation, newLightness] = toHsl(result[0], result[1], result[2]);
    assert.ok(Math.abs(hue - newHue) < 1e-12);
    assert.ok(Math.abs(saturation - newSaturation) < 1e-12);
    assert.ok(Math.abs(1 - lightness - newLightness) < 1e-12);
    assert.deepEqual(invert(result), [...rgba]);
  }
});
