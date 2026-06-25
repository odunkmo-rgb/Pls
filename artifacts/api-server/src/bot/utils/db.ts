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

export async function ensureSettingsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      yetkili_rol_id TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function getYetkiliRolId(guildId: string): Promise<string | null> {
  try {
    const rows = await query<{ yetkili_rol_id: string | null }>(
      "SELECT yetkili_rol_id FROM guild_settings WHERE guild_id = $1",
      [guildId],
    );
    return rows[0]?.yetkili_rol_id ?? null;
  } catch {
    return null;
  }
}

export async function setYetkiliRolId(guildId: string, rolId: string): Promise<void> {
  await query(
    `INSERT INTO guild_settings (guild_id, yetkili_rol_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET yetkili_rol_id = $2, updated_at = NOW()`,
    [guildId, rolId],
  );
}
