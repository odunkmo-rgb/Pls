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
      link_engel_aktif BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Mevcut tablo varsa eksik kolonu ekle
  await query(`
    ALTER TABLE guild_settings
    ADD COLUMN IF NOT EXISTS link_engel_aktif BOOLEAN DEFAULT FALSE
  `).catch(() => { /* zaten varsa geç */ });
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

export async function getLinkEngelAktif(guildId: string): Promise<boolean> {
  try {
    const rows = await query<{ link_engel_aktif: boolean }>(
      "SELECT link_engel_aktif FROM guild_settings WHERE guild_id = $1",
      [guildId],
    );
    return rows[0]?.link_engel_aktif ?? false;
  } catch {
    return false;
  }
}

export async function setLinkEngelAktif(guildId: string, aktif: boolean): Promise<void> {
  await query(
    `INSERT INTO guild_settings (guild_id, link_engel_aktif)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET link_engel_aktif = $2, updated_at = NOW()`,
    [guildId, aktif],
  );
}
