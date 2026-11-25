// Synthetic WoW window captures for the bridge reader tests: a BGRA bitmap of noisy "game"
// pixels with a pixel-bridge strip drawn the way the addon draws it (3 x 2 px blocks along the
// top edge, starting at the left).
import { GREYS, BLOCK_W, BLOCK_H } from '../../../src/bridge/codec.js';

// Small deterministic generator so every run draws the same pixels.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 2 ** 32;
  };
}

export function gameBitmap(width, height, seed = 1) {
  const r = rng(seed);
  const bitmap = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    bitmap[i * 4] = Math.floor(r() * 256);
    bitmap[i * 4 + 1] = Math.floor(r() * 256);
    bitmap[i * 4 + 2] = Math.floor(r() * 256);
    bitmap[i * 4 + 3] = 255;
  }
  return { bitmap, width, height };
}

// Draws symbols as grey blocks from (x0, y0), each grey off by up to +-noise per channel.
export function drawStrip(img, symbols, { x0 = 0, y0 = 0, noise = 3, seed = 2 } = {}) {
  const r = rng(seed);
  symbols.forEach((sym, i) => {
    for (let dy = 0; dy < BLOCK_H; dy++) {
      for (let dx = 0; dx < BLOCK_W; dx++) {
        const x = x0 + i * BLOCK_W + dx;
        const y = y0 + dy;
        if (x >= img.width || y >= img.height) continue;
        const o = (y * img.width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const v = GREYS[sym] + Math.round((r() * 2 - 1) * noise);
          img.bitmap[o + c] = Math.max(0, Math.min(255, v));
        }
        img.bitmap[o + 3] = 255;
      }
    }
  });
  return img;
}
