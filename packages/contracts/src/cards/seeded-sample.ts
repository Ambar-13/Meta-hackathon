// A small SHA-256 and SplitMix64, so the quiz sample is the same in Node and in the browser.
// Contracts code runs in both, so it cannot use node:crypto, and crypto.subtle is asynchronous.

// The 64 round constants of SHA-256 (FIPS 180-4).
const ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
// The eight starting words of the SHA-256 state (FIPS 180-4).
const START_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
// Keeps a BigInt inside 64 bits.
const MASK_64 = (1n << 64n) - 1n;

const word = (words: ArrayLike<number>, index: number): number => words[index] ?? 0;
const rotateRight = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

// Pads the message to whole 64-byte blocks, with its length in bits in the last 8 bytes (FIPS
// 180-4).
function padMessage(message: Uint8Array): DataView {
  const padded = new Uint8Array(Math.ceil((message.length + 9) / 64) * 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(message.length / 0x20000000));
  view.setUint32(padded.length - 4, (message.length * 8) >>> 0);
  return view;
}

// Expands one 64-byte block into the 64-word message schedule (FIPS 180-4, 6.2.2 step 1).
function messageSchedule(view: DataView, offset: number): Uint32Array {
  const schedule = new Uint32Array(64);
  for (let index = 0; index < 16; index += 1) schedule[index] = view.getUint32(offset + index * 4);
  for (let index = 16; index < 64; index += 1) {
    const back15 = word(schedule, index - 15);
    const back2 = word(schedule, index - 2);
    const sigma0 = rotateRight(back15, 7) ^ rotateRight(back15, 18) ^ (back15 >>> 3);
    const sigma1 = rotateRight(back2, 17) ^ rotateRight(back2, 19) ^ (back2 >>> 10);
    schedule[index] =
      (word(schedule, index - 16) + sigma0 + word(schedule, index - 7) + sigma1) >>> 0;
  }
  return schedule;
}

// One round of the compression on the eight working words a to h, in place (FIPS 180-4, 6.2.2 step
// 3).
function compressionRound(work: Uint32Array, constant: number, scheduled: number): void {
  const a = word(work, 0);
  const b = word(work, 1);
  const c = word(work, 2);
  const d = word(work, 3);
  const e = word(work, 4);
  const f = word(work, 5);
  const g = word(work, 6);
  const h = word(work, 7);
  const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
  const choose = (e & f) ^ (~e & g);
  const first = (h + sum1 + choose + constant + scheduled) >>> 0;
  const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
  const majority = (a & b) ^ (a & c) ^ (b & c);
  work.set([(first + sum0 + majority) >>> 0, a, b, c, (d + first) >>> 0, e, f, g]);
}

// Runs the 64 rounds on one block and adds the result into the state (FIPS 180-4, 6.2.2 steps 2 to
// 4).
function compressBlock(state: Uint32Array, schedule: Uint32Array): void {
  const work = Uint32Array.from(state);
  for (let round = 0; round < 64; round += 1)
    compressionRound(work, word(ROUND_CONSTANTS, round), word(schedule, round));
  state.set(state.map((value, index) => value + word(work, index)));
}

// The SHA-256 digest of some bytes, 32 bytes long.
export function sha256(message: Uint8Array): Uint8Array {
  const view = padMessage(message);
  const state = Uint32Array.from(START_STATE);
  for (let offset = 0; offset < view.byteLength; offset += 64)
    compressBlock(state, messageSchedule(view, offset));
  const digest = new DataView(new ArrayBuffer(32));
  state.forEach((value, index) => {
    digest.setUint32(index * 4, value);
  });
  return new Uint8Array(digest.buffer);
}

// One step of SplitMix64: the new state and the 64-bit output for it.
function splitMix64(state: bigint): { state: bigint; output: bigint } {
  const next = (state + 0x9e3779b97f4a7c15n) & MASK_64;
  let mixed = ((next ^ (next >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  mixed = ((mixed ^ (mixed >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  return { state: next, output: mixed ^ (mixed >> 31n) };
}

// Picks `count` distinct ids from 1 to `total`, the same ones every time for the same seed text, in
// ascending order. Seed: the first 8 bytes of sha256(seed text), unsigned big-endian. Shuffle:
// Fisher-Yates from the last place down, swapping place i with place (SplitMix64 output mod (i +
// 1)).
export function seededSample(seedText: string, count: number, total: number): number[] {
  const ids = Array.from({ length: total }, (value, index) => index + 1);
  let state = new DataView(sha256(new TextEncoder().encode(seedText)).buffer).getBigUint64(0);
  for (let place = total - 1; place >= 1; place -= 1) {
    const step = splitMix64(state);
    state = step.state;
    const other = Number(step.output % BigInt(place + 1));
    [ids[place], ids[other]] = [word(ids, other), word(ids, place)];
  }
  return ids.slice(0, count).sort((left, right) => left - right);
}
