import { mapConcurrent } from './parallel';
test('runs concurrently with a ceiling and preserves order despite reverse completion', async () => {
  let active = 0, peak = 0;
  const result = await mapConcurrent([4, 3, 2, 1], 2, async n => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, n)); active--; return n * 2;
  });
  expect(result).toEqual([8, 6, 4, 2]); expect(peak).toBe(2); expect(active).toBe(0);
});
test('propagates failures instead of returning partial successful totals', async () => {
  await expect(mapConcurrent([1, 2, 3], 2, async n => { if (n === 2) throw new Error('unavailable'); return n; })).rejects.toThrow('unavailable');
});
