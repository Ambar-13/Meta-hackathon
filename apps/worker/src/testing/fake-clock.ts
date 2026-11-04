// A fake clock: now() is the start plus every advance. Tests that use it say "fake clock".
export function fakeClock(start: Date): { now: () => Date; advance: (ms: number) => void } {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

// A fake sleep that returns at once and records each wait. Tests that use it say "fake sleep".
export function fakeSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    sleep: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
    waits,
  };
}

// A fake random source that returns the given values in turn and then the last one again. Tests
// that use it say "fake random".
export function fakeRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}
