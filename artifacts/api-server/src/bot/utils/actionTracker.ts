import { CONFIG } from "../config.js";

interface ActionRecord {
  count: number;
  firstActionAt: number;
  actions: Array<{ type: string; target: string; at: number }>;
}

const tracker = new Map<string, ActionRecord>();

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
