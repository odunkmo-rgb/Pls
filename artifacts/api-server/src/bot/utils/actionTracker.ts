import { CONFIG } from "../config.js";

interface ActionRecord {
  count: number;
  firstActionAt: number;
  actions: Array<{ type: string; target: string; at: number }>;
}

const tracker = new Map<string, ActionRecord>();

// Üye rol cache'i — GuildMemberRemove'da güncellenir, GuildBanAdd'de kullanılır
const memberRoleCache = new Map<string, string[]>();

export function cacheMemberRoles(userId: string, roleIds: string[]): void {
  memberRoleCache.set(userId, roleIds);
  // Cache'i sınırlı tut (max 200 üye)
  if (memberRoleCache.size > 200) {
    const firstKey = memberRoleCache.keys().next().value;
    if (firstKey) memberRoleCache.delete(firstKey);
  }
}

export function getCachedMemberRoles(userId: string): string[] {
  return memberRoleCache.get(userId) ?? [];
}

export function isExemptUser(userId: string): boolean {
  return (CONFIG.ALLOWED_USER_IDS as readonly string[]).includes(userId);
}

export function isExemptRole(roleIds: string[]): boolean {
  return roleIds.some((id) =>
    (CONFIG.EXEMPT_ROLE_IDS as readonly string[]).includes(id),
  );
}

export function isExemptExecutor(userId: string, roleIds: string[]): boolean {
  return isExemptUser(userId) || isExemptRole(roleIds);
}

/** Sadece muaf ROL yüzünden muaf (ALLOWED_USER değil) — bu kişilere DM atılır */
export function isExemptRoleOnly(userId: string, roleIds: string[]): boolean {
  return !isExemptUser(userId) && isExemptRole(roleIds);
}

/**
 * Hedefin korumalı olup olmadığını kontrol eder:
 * - Özel 3 kişiden biri ise → korumalı
 * - Yetkili rolüne sahipse → korumalı
 */
export function isTargetProtected(
  targetId: string,
  targetRoleIds: string[],
  yetkiliRolId: string | null,
): boolean {
  if (isExemptUser(targetId)) return true;
  if (yetkiliRolId && targetRoleIds.includes(yetkiliRolId)) return true;
  return false;
}

/**
 * Executor'ın yetkili rolüne sahip olup olmadığını kontrol eder
 * ama özel 3 kişiden biri DEĞİL
 */
export function isNonSpecialYetkili(
  executorId: string,
  executorRoleIds: string[],
  yetkiliRolId: string | null,
): boolean {
  if (!yetkiliRolId) return false;
  if (isExemptUser(executorId)) return false; // Özel kişi → bu kural uygulanmaz
  return executorRoleIds.includes(yetkiliRolId);
}

export function recordAction(
  userId: string,
  type: string,
  target: string,
): { exceeded: boolean; warning: boolean; count: number } {
  const now = Date.now();
  let record = tracker.get(userId);

  if (!record) {
    record = { count: 0, firstActionAt: now, actions: [] };
    tracker.set(userId, record);
  }

  if (CONFIG.ACTION_WINDOW_MS > 0) {
    const windowStart = now - CONFIG.ACTION_WINDOW_MS;
    record.actions = record.actions.filter((a) => a.at > windowStart);
    record.count = record.actions.length;
  }

  record.actions.push({ type, target, at: now });
  record.count++;

  const warning = record.count === CONFIG.ACTION_LIMIT;
  const exceeded = record.count > CONFIG.ACTION_LIMIT;
  return { exceeded, warning, count: record.count };
}

export function resetUser(userId: string): void {
  tracker.delete(userId);
}

export function getRecord(userId: string): ActionRecord | undefined {
  return tracker.get(userId);
}
