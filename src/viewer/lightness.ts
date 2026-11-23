/**
 * Invert HSL lightness in straight-alpha, 8-bit RGBA pixels.
 *
 * HSL lightness is (max + min) / 2. Reflecting lightness around 0.5
 * preserves chroma for the same saturation. Adding 255 - max - min
 * to each channel gives that reflection while preserving hue and alpha.
 */
export function invertLightness(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i];
    const green = pixels[i + 1];
    const blue = pixels[i + 2];
    const shift = 255 - Math.max(red, green, blue) - Math.min(red, green, blue);
    pixels[i] = red + shift;
    pixels[i + 1] = green + shift;
    pixels[i + 2] = blue + shift;
  }
}
