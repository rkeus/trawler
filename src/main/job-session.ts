import { randomUUID } from 'node:crypto';
import { session, type Session } from 'electron';

/** Local-network checks stay open: pages are loaded from 127.0.0.1 (preview, local fixtures). */
const ALLOWED_PERMISSION_CHECKS = new Set<string>(['local-network-access', 'local-network', 'loopback-network']);

/**
 * A fresh in-memory session per job (no "persist:" prefix): its own cookies and cache, nothing written to disk.
 * Permission prompts are denied and downloads are cancelled (spec §8).
 */
export function createJobSession(userAgent?: string): Session {
  const ses = session.fromPartition(`trawler-${randomUUID()}`);
  if (userAgent) ses.setUserAgent(userAgent);
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler((_webContents, permission) => ALLOWED_PERMISSION_CHECKS.has(permission));
  ses.on('will-download', (event) => event.preventDefault());
  return ses;
}
