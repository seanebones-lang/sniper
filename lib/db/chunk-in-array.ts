/** Postgres rejects IN (...) lists larger than ~65535 parameters. */
export const PG_IN_ARRAY_CHUNK_SIZE = 500;

export function chunkArray<T>(items: T[], size = PG_IN_ARRAY_CHUNK_SIZE): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
