import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env["DATABASE_URL"];
    if (!url) {
      throw new Error("DATABASE_URL ortam değişkeni bulunamadı.");
    }
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const client = getPool();
  const result = await client.query<T>(sql, params);
  return result.rows;
}
