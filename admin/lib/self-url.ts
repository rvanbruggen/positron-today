export function selfUrl(path: string): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}${path}`;
  }
  const port = process.env.PORT ?? "3000";
  return `http://localhost:${port}${path}`;
}
