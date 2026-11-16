import type { DefaultTreeAdapterMap } from 'parse5';

export type Element = DefaultTreeAdapterMap['element'];
export type ParentNode = DefaultTreeAdapterMap['parentNode'];
export type TextNode = DefaultTreeAdapterMap['textNode'];
export type Template = DefaultTreeAdapterMap['template'];

export function isElement(node: { nodeName: string }): node is Element {
  return 'tagName' in node;
}

/** Attribute key as written in source: "xlink:href" for prefixed foreign attributes, else the name. */
export function attrKey(a: { name: string; prefix?: string }): string {
  return a.prefix ? `${a.prefix}:${a.name}` : a.name;
}

export function getAttr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => attrKey(a) === name)?.value;
}
