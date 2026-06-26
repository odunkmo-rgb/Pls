import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function hasDatabase(): boolean {
  return !!process.env["DATABASE_URL"];
}

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env["DATABASE_URL"],
      ssl: process.env["NODE_ENV"] === "production"
        ? { rejectUnauthorized: false }
        : false,
    });
  }
  return pool;
}

async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const client = getPool();
  const result = await client.query<T>(sql, params);
  return result.rows;
}

// ── In-memory fallback (DATABASE_URL yoksa) ──────────────────────────────────
interface GuildSettings {
  yetkiliRolId: string | null;
  linkEngelAktif: boolean;
}

const memoryStore = new Map<string, GuildSettings>();

function getMemory(guildId: string): GuildSettings {
  if (!memoryStore.has(guildId)) {
    memoryStore.set(guildId, { yetkiliRolId: null, linkEngelAktif: false });
  }
  return memoryStore.get(guildId)!;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function ensureSettingsTable(): Promise<void> {
  if (!hasDatabase()) {
    console.warn("DATABASE_URL bulunamadı. Ayarlar bellekte tutulacak (bot yeniden başlayınca sıfırlanır).");
    return;
  }
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        yetkili_rol_id TEXT,
        link_engel_aktif BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`
      ALTER TABLE guild_settings
      ADD COLUMN IF NOT EXISTS link_engel_aktif BOOLEAN DEFAULT FALSE
    `).catch(() => {});
  } catch (err) {
    console.error("guild_settings tablosu oluşturulamadı:", err);
  }
}

export async function getYetkiliRolId(guildId: string): Promise<string | null> {
  if (!hasDatabase()) return getMemory(guildId).yetkiliRolId;
  try {
    const rows = await query<{ yetkili_rol_id: string | null }>(
      "SELECT yetkili_rol_id FROM guild_settings WHERE guild_id = $1",
      [guildId],
    );
    return rows[0]?.yetkili_rol_id ?? null;
  } catch {
    return getMemory(guildId).yetkiliRolId;
  }
}

export async function setYetkiliRolId(guildId: string, rolId: string): Promise<void> {
  if (!hasDatabase()) {
    getMemory(guildId).yetkiliRolId = rolId;
    return;
  }
  try {
    await query(
      `INSERT INTO guild_settings (guild_id, yetkili_rol_id)
       VALUES ($1, $2)
       ON CONFLICT (guild_id) DO UPDATE SET yetkili_rol_id = $2, updated_at = NOW()`,
      [guildId, rolId],
    );
  } catch (err) {
    console.error("setYetkiliRolId hatası:", err);
    getMemory(guildId).yetkiliRolId = rolId;
  }
}

export async function getLinkEngelAktif(guildId: string): Promise<boolean> {
  if (!hasDatabase()) return getMemory(guildId).linkEngelAktif;
  try {
    const rows = await query<{ link_engel_aktif: boolean }>(
      "SELECT link_engel_aktif FROM guild_settings WHERE guild_id = $1",
      [guildId],
    );
    return rows[0]?.link_engel_aktif ?? false;
  } catch {
    return getMemory(guildId).linkEngelAktif;
  }
}

export async function setLinkEngelAktif(guildId: string, aktif: boolean): Promise<void> {
  if (!hasDatabase()) {
    getMemory(guildId).linkEngelAktif = aktif;
    return;
  }
  try {
    await query(
      `INSERT INTO guild_settings (guild_id, link_engel_aktif)
       VALUES ($1, $2)
       ON CONFLICT (guild_id) DO UPDATE SET link_engel_aktif = $2, updated_at = NOW()`,
      [guildId, aktif],
    );
  } catch (err) {
    console.error("setLinkEngelAktif hatası:", err);
    getMemory(guildId).linkEngelAktif = aktif;
  }
}
