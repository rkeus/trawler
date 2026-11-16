export type TextEncodingKind = 'utf8' | 'latin1';

export interface DecodedText {
  text: string;
  encoding: TextEncodingKind;
}

const UTF8_NAMES = new Set(['utf-8', 'utf8', 'unicode-1-1-utf-8']);

function declaredCharset(body: Buffer, contentType: string | undefined): string | undefined {
  const fromHeader = contentType ? /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] : undefined;
  if (fromHeader) return fromHeader.toLowerCase();
  const head = body.subarray(0, 1024).toString('latin1');
  return /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
}

/**
 * Decodes a text body so it can be re-encoded byte-exactly after URL rewriting:
 * UTF-8 when declared (or undeclared) and valid, otherwise latin1, which maps every byte to one char.
 * The BOM is kept in the text.
 */
export function decodeBody(body: Buffer, contentType: string | undefined): DecodedText {
  const declared = declaredCharset(body, contentType);
  if (declared === undefined || UTF8_NAMES.has(declared)) {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body), encoding: 'utf8' };
    } catch {
      // invalid UTF-8: fall through to latin1
    }
  }
  return { text: body.toString('latin1'), encoding: 'latin1' };
}

export function encodeBody(text: string, encoding: TextEncodingKind): Buffer {
  return Buffer.from(text, encoding);
}

/** Points the document's first charset declaration at UTF-8 (used when a page is stored as UTF-8 text). */
export function declareUtf8(html: string): string {
  return html.replace(/(<meta\b[^>]*?charset\s*=\s*["']?)([\w-]+)/i, '$1utf-8');
}
