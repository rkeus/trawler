import { randomUUID } from 'node:crypto';
import { session, type Session } from 'electron';
import { cleanUserAgent } from './user-agent';

/** Local-network checks stay open: pages are loaded from 127.0.0.1 (preview, local fixtures). */
const ALLOWED_PERMISSION_CHECKS = new Set<string>(['local-network-access', 'local-network', 'loopback-network']);

/**
 * Sets up a session for crawling: permission prompts are denied and downloads are cancelled (spec section 8).
 * Without a configured user agent the session uses Chromium's own (Electron and app tokens removed).
 * Call it once per session: it adds a listener.
 */
export function configureJobSession(ses: Session, userAgent?: string): Session {
  ses.setUserAgent(userAgent || cleanUserAgent(ses.getUserAgent()));
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler((_webContents, permission) => ALLOWED_PERMISSION_CHECKS.has(permission));
  ses.on('will-download', (event) => event.preventDefault());
  return ses;
}

/** A fresh in-memory session (no "persist:" prefix): its own cookies and cache, nothing written to disk. */
export function createJobSession(userAgent?: string): Session {
  return configureJobSession(session.fromPartition(`trawler-${randomUUID()}`), userAgent);
}
