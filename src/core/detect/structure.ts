import { parse } from 'parse5';
import { getAttr, isElement, type Element, type ParentNode, type TextNode } from '../html/dom';

export interface HtmlStructure {
  /** visible text characters inside <body> (whitespace collapsed) */
  textLength: number;
  /** elements inside <body> (excluding body itself) */
  elementCount: number;
  moduleScripts: number;
  /** e.g. ["#root"] — known SPA mount points that are empty */
  emptyMountIds: string[];
}

const SKIP_TEXT = new Set(['script', 'style', 'noscript', 'template']);
const MOUNT_IDS = ['root', 'app', '__next', '__nuxt', 'svelte'];

function isEmpty(el: Element): boolean {
  return el.childNodes.every(
    (c) => c.nodeName === '#comment' || (c.nodeName === '#text' && (c as TextNode).value.trim() === ''),
  );
}

export function analyzeStructure(html: string): HtmlStructure {
  const doc = parse(html);
  const result: HtmlStructure = { textLength: 0, elementCount: 0, moduleScripts: 0, emptyMountIds: [] };

  const visit = (node: ParentNode, inBody: boolean, skipText: boolean): void => {
    for (const child of node.childNodes) {
      if (child.nodeName === '#text') {
        if (inBody && !skipText) result.textLength += (child as TextNode).value.replace(/\s+/g, ' ').trim().length;
        continue;
      }
      if (!isElement(child)) continue;
      const tag = child.tagName;
      const nowInBody = inBody || tag === 'body';
      if (inBody) result.elementCount++;
      if (tag === 'script' && (getAttr(child, 'type') ?? '').toLowerCase() === 'module') result.moduleScripts++;
      const id = getAttr(child, 'id');
      if (id && MOUNT_IDS.includes(id) && isEmpty(child)) result.emptyMountIds.push(`#${id}`);
      if (getAttr(child, 'ng-app') !== undefined && isEmpty(child)) result.emptyMountIds.push('[ng-app]');
      visit(child, nowInBody, skipText || SKIP_TEXT.has(tag));
    }
  };
  visit(doc, false, false);
  return result;
}
