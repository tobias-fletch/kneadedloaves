export async function runBounded(step: () => Promise<number>, maxSteps: number) {
  if (!Number.isInteger(maxSteps) || maxSteps < 1) return 0;
  let total = 0;
  for (let stepNumber = 0; stepNumber < maxSteps; stepNumber++) {
    const count = await step();
    if (!Number.isInteger(count) || count < 0) break;
    total += count;
    if (count === 0) break;
  }
  return total;
}
