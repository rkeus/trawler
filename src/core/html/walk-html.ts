import { parse } from 'parse5';
import type { AssetKind, RefSource } from '../../shared/types';
import { walkCss, type CssRefSource } from '../css/walk-css';
import { attrKey, getAttr, isElement, type Element, type ParentNode, type Template } from './dom';
import { parseSrcset, stringifySrcset } from './srcset';

export type HtmlRefRole = 'asset' | 'page' | 'base';

export interface HtmlRefSite {
  /** URL as written (HTML entities already decoded) */
  raw: string;
  role: HtmlRefRole;
  /** null → infer from URL */
  kindHint: AssetKind | null;
  source: RefSource;
  tag: string;
  /** null for <style> block content */
  attr: string | null;
  /** true for lazy-load data-* attributes: rewrite only to a downloaded local file, never absolutize */
  optional: boolean;
}

/** string → replace, null → remove the attribute (used for <base href>), undefined → leave */
export type HtmlVisitor = (site: HtmlRefSite) => string | null | undefined;

type AttrMode = 'url' | 'srcset' | 'style' | 'lazy';

interface AttrSite {
  attr: string;
  role: HtmlRefRole;
  kind: AssetKind | null;
  mode: AttrMode;
  optional: boolean;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface WalkState {
  /** source offsets already handled — parse5 clones formatting elements with identical locations */
  seen: Set<number>;
  baseSeen: boolean;
}

const LAZY_URL_ATTRS = [
  'data-src',
  'data-bg',
  'data-background',
  'data-background-image',
  'data-bg-src',
  'data-image',
  'data-lazy',
  'data-original',
];
const LAZY_SRCSET_ATTRS = ['data-srcset'];
const ICON_RELS = ['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'mask-icon'];
const META_IMAGE_KEYS = ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'msapplication-tileimage'];

function preloadKind(as: string | undefined): AssetKind | null {
  switch ((as ?? '').toLowerCase()) {
    case 'style':
      return 'css';
    case 'script':
      return 'js';
    case 'font':
      return 'font';
    case 'image':
      return 'image';
    case 'fetch':
      return 'data';
    case 'video':
    case 'audio':
      return 'media';
    default:
      return null;
  }
}

/** Lazy attributes often hold colors, numbers or flags — accept only path-like values. */
function looksLikeUrl(raw: string): boolean {
  if (!raw || /\s/.test(raw) || raw.includes('(')) return false;
  return raw.includes('/') || /\.[a-z0-9]{2,5}(?:[?#]|$)/i.test(raw);
}

function attrSites(el: Element): AttrSite[] {
  const out: AttrSite[] = [];
  const add = (attr: string, role: HtmlRefRole, kind: AssetKind | null, mode: AttrMode = 'url', optional = false) =>
    out.push({ attr, role, kind, mode, optional });

  switch (el.tagName) {
    case 'base':
      add('href', 'base', null);
      break;
    case 'link': {
      const rels = (getAttr(el, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      if (rels.includes('stylesheet')) add('href', 'asset', 'css');
      else if (rels.some((r) => ICON_RELS.includes(r))) add('href', 'asset', 'image');
      else if (rels.includes('manifest')) add('href', 'asset', 'data');
      else if (rels.includes('modulepreload')) add('href', 'asset', 'js');
      else if (rels.includes('preload') || rels.includes('prefetch')) add('href', 'asset', preloadKind(getAttr(el, 'as')));
      if (rels.includes('preload')) add('imagesrcset', 'asset', 'image', 'srcset');
      break;
    }
    case 'script':
      add('src', 'asset', 'js');
      break;
    case 'img':
      add('src', 'asset', 'image');
      add('srcset', 'asset', 'image', 'srcset');
      break;
    case 'source':
      add('src', 'asset', null);
      add('srcset', 'asset', 'image', 'srcset');
      break;
    case 'video':
      add('src', 'asset', 'media');
      add('poster', 'asset', 'image');
      break;
    case 'audio':
      add('src', 'asset', 'media');
      break;
    case 'track':
      add('src', 'asset', 'other');
      break;
    case 'embed':
      add('src', 'asset', null);
      break;
    case 'object':
      add('data', 'asset', null);
      break;
    case 'input':
      if ((getAttr(el, 'type') ?? '').toLowerCase() === 'image') add('src', 'asset', 'image');
      break;
    case 'iframe':
      add('src', 'page', null);
      break;
    case 'a':
    case 'area':
      add('href', 'page', null);
      break;
    case 'meta': {
      const key = (getAttr(el, 'property') ?? getAttr(el, 'name') ?? '').toLowerCase();
      if (META_IMAGE_KEYS.includes(key)) add('content', 'asset', 'image');
      break;
    }
    case 'use':
    case 'image':
      add('href', 'asset', 'image');
      add('xlink:href', 'asset', 'image');
      break;
  }
  for (const a of LAZY_URL_ATTRS) add(a, 'asset', null, 'lazy', true);
  for (const a of LAZY_SRCSET_ATTRS) add(a, 'asset', 'image', 'srcset', true);
  add('style', 'asset', null, 'style');
  return out.filter((s) => el.attrs.some((a) => attrKey(a) === s.attr));
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function replaceAttrText(original: string, value: string): string {
  const eq = original.indexOf('=');
  const name = eq < 0 ? original : original.slice(0, eq).trimEnd();
  return `${name}="${escapeAttr(value)}"`;
}

function cssVisit(
  visit: HtmlVisitor,
  raw: string,
  src: CssRefSource,
  source: RefSource,
  tag: string,
  attr: string | null,
): string | undefined {
  const r = visit({ raw, role: 'asset', kindHint: src === 'css-import' ? 'css' : null, source, tag, attr, optional: false });
  return r === null ? undefined : r;
}

/** Returns the new attribute value, null to remove the attribute, or undefined for no change. */
function rewriteAttrValue(value: string, site: AttrSite, tag: string, visit: HtmlVisitor): string | null | undefined {
  const where = { tag, attr: site.attr, optional: site.optional };
  switch (site.mode) {
    case 'url': {
      const r = visit({ raw: value, role: site.role, kindHint: site.kind, source: 'html-attr', ...where });
      if (r === null) return null;
      return r !== undefined && r !== value ? r : undefined;
    }
    case 'lazy': {
      const m = /^\s*url\(\s*(['"]?)(.*?)\1\s*\)\s*$/i.exec(value);
      const raw = m ? m[2]! : value.trim();
      if (!looksLikeUrl(raw)) return undefined;
      const r = visit({ raw, role: 'asset', kindHint: site.kind, source: 'html-attr', ...where });
      if (typeof r !== 'string' || r === raw) return undefined;
      return m ? `url("${r}")` : r;
    }
    case 'srcset': {
      const candidates = parseSrcset(value);
      let changed = false;
      for (const c of candidates) {
        const r = visit({ raw: c.url, role: 'asset', kindHint: site.kind, source: 'srcset', ...where });
        if (typeof r === 'string' && r !== c.url) {
          c.url = r;
          changed = true;
        }
      }
      return changed ? stringifySrcset(candidates) : undefined;
    }
    case 'style': {
      const wrapped = `*{${value}}`;
      const next = walkCss(wrapped, (raw, src) => cssVisit(visit, raw, src, 'inline-style', tag, site.attr));
      return next === wrapped ? undefined : next.slice(2, -1);
    }
  }
}

function handleElement(html: string, el: Element, visit: HtmlVisitor, edits: Edit[], state: WalkState): void {
  for (const site of attrSites(el)) {
    const a = el.attrs.find((x) => attrKey(x) === site.attr);
    const loc = el.sourceCodeLocation?.attrs?.[site.attr];
    if (!a || !loc || state.seen.has(loc.startOffset)) continue;
    state.seen.add(loc.startOffset);
    if (site.role === 'base') {
      if (state.baseSeen) continue; // browsers honor only the first base[href]
      state.baseSeen = true;
    }
    const next = rewriteAttrValue(a.value, site, el.tagName, visit);
    if (next === undefined) continue;
    edits.push({
      start: loc.startOffset,
      end: loc.endOffset,
      text: next === null ? '' : replaceAttrText(html.slice(loc.startOffset, loc.endOffset), next),
    });
  }

  if (el.tagName === 'style') {
    for (const child of el.childNodes) {
      const loc = child.nodeName === '#text' ? child.sourceCodeLocation : undefined;
      if (!loc || state.seen.has(loc.startOffset)) continue;
      state.seen.add(loc.startOffset);
      // use the raw source (not parse5's normalized text) so CRLF and other bytes survive
      const css = html.slice(loc.startOffset, loc.endOffset);
      const next = walkCss(css, (raw, src) => cssVisit(visit, raw, src, 'style-block', 'style', null));
      if (next !== css) edits.push({ start: loc.startOffset, end: loc.endOffset, text: next });
    }
  }
}

/**
 * Single HTML URL walker used by both extraction and rewriting. Visits URL-bearing attributes, srcset
 * candidates, inline styles and <style> blocks in document order (so the first <base> is seen first).
 * Rewrites by splicing the original string: untouched markup stays byte-identical. Each source offset is
 * visited once, and overlapping edits are dropped, so parse5's element reconstruction cannot corrupt output.
 */
export function walkHtml(html: string, visit: HtmlVisitor): string {
  const doc = parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: false });
  const edits: Edit[] = [];
  const state: WalkState = { seen: new Set(), baseSeen: false };

  const walk = (parent: ParentNode): void => {
    for (const node of parent.childNodes) {
      if (!isElement(node)) continue;
      handleElement(html, node, visit, edits, state);
      if (node.tagName === 'template') walk((node as Template).content);
      walk(node);
    }
  };
  walk(doc);

  if (edits.length === 0) return html;
  edits.sort((a, b) => b.start - a.start);
  let out = html;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const e of edits) {
    if (e.end > lastStart) continue; // overlaps an edit already applied
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
  }
  return out;
}
