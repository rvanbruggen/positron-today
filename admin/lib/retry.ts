/**
 * Generic retry with exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseDelayMs?: number; label?: string },
): Promise<T> {
  const attempts = opts?.attempts ?? 3;
  const baseDelay = opts?.baseDelayMs ?? 500;
  const label = opts?.label ?? "operation";

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.warn(`[retry] ${label} attempt ${i + 1}/${attempts} failed, retrying in ${delay}ms: ${err instanceof Error ? err.message : err}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
