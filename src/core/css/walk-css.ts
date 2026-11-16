import safeParse from 'postcss-safe-parser';
import valueParser from 'postcss-value-parser';

export type CssRefSource = 'css-url' | 'css-import';

/** Receives the unescaped URL; returns a new URL string to replace it, or undefined to leave it. */
export type CssVisitor = (raw: string, source: CssRefSource) => string | undefined;

/** U+FFFD, written as a code point so the source stays ASCII-only. */
const REPLACEMENT_CHAR = String.fromCodePoint(0xfffd);

const CSS_ESCAPE =/\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|(\r\n|[\n\r\f])|([\s\S]))/g;

/** Decodes CSS escapes: "\28 " and "\(" → "(", backslash-newline → removed. */
export function unescapeCss(s: string): string {
  if (!s.includes('\\')) return s;
  return s.replace(CSS_ESCAPE, (_m, hex: string | undefined, nl: string | undefined, ch: string | undefined) => {
    if (hex) {
      const cp = parseInt(hex, 16);
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? REPLACEMENT_CHAR : String.fromCodePoint(cp);
    }
    if (nl) return '';
    return ch ?? '';
  });
}

/** Escapes a value for use inside a double-quoted CSS string. */
function escapeCssString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');
}

function stringNode(value: string): valueParser.StringNode {
  return {
    type: 'string',
    value: escapeCssString(value),
    quote: '"',
    sourceIndex: 0,
    sourceEndIndex: 0,
  } as valueParser.StringNode;
}

/** Visits one (possibly escaped) value. Returns the replacement (unescaped) or undefined if unchanged. */
function visitValue(escaped: string, source: CssRefSource, visit: CssVisitor): string | undefined {
  const raw = unescapeCss(escaped);
  const next = visit(raw, source);
  return next === undefined || next === raw ? undefined : next;
}

function setString(node: valueParser.StringNode, value: string): void {
  node.value = escapeCssString(value);
  node.quote = '"';
}

/** Visits url() inside a function node. Returns true if the node was changed. */
function visitUrlFunction(node: valueParser.FunctionNode, source: CssRefSource, visit: CssVisitor): boolean {
  const inner = node.nodes[0];
  if (!inner || (inner.type !== 'string' && inner.type !== 'word')) return false;
  const next = visitValue(inner.value, source, visit);
  if (next === undefined) return false;
  node.nodes = [stringNode(next)];
  return true;
}

/**
 * Single CSS URL walker used by both extraction and rewriting.
 * Covers url(), image-set()/-webkit-image-set() strings and @import. Visitors receive unescaped values;
 * replacements are written as escaped, double-quoted strings. If nothing changes, the input string is
 * returned as-is (byte-identical). Known limitation: comments inside a rewritten declaration value are dropped.
 */
export function walkCss(css: string, visit: CssVisitor): string {
  let root: ReturnType<typeof safeParse>;
  try {
    root = safeParse(css);
  } catch {
    return css;
  }
  let changed = false;

  root.walkAtRules((rule) => {
    if (rule.name.toLowerCase() !== 'import') return;
    const parsed = valueParser(rule.params);
    const first = parsed.nodes.find((n) => n.type !== 'space');
    if (!first) return;
    let ruleChanged = false;
    if (first.type === 'string') {
      const next = visitValue(first.value, 'css-import', visit);
      if (next !== undefined) {
        setString(first, next);
        ruleChanged = true;
      }
    } else if (first.type === 'function' && first.value.toLowerCase() === 'url') {
      ruleChanged = visitUrlFunction(first, 'css-import', visit);
    }
    if (ruleChanged) {
      rule.params = parsed.toString();
      changed = true;
    }
  });

  root.walkDecls((decl) => {
    if (!/url\(|image-set\(/i.test(decl.value)) return;
    const parsed = valueParser(decl.value);
    let declChanged = false;
    parsed.walk((node) => {
      if (node.type !== 'function') return;
      const name = node.value.toLowerCase();
      if (name === 'url') {
        if (visitUrlFunction(node, 'css-url', visit)) declChanged = true;
        return false;
      }
      if (name === 'image-set' || name === '-webkit-image-set') {
        for (const child of node.nodes) {
          if (child.type !== 'string') continue;
          const next = visitValue(child.value, 'css-url', visit);
          if (next !== undefined) {
            setString(child, next);
            declChanged = true;
          }
        }
      }
      return undefined;
    });
    if (declChanged) {
      decl.value = parsed.toString();
      changed = true;
    }
  });

  return changed ? root.toString() : css;
}
