import safeParse from 'postcss-safe-parser';
import valueParser from 'postcss-value-parser';

export type CssRefSource = 'css-url' | 'css-import';

/** Return a new URL string to replace `raw`, or undefined to leave it. */
export type CssVisitor = (raw: string, source: CssRefSource) => string | undefined;

function stringNode(value: string): valueParser.StringNode {
  return { type: 'string', value, quote: '"', sourceIndex: 0, sourceEndIndex: 0 } as valueParser.StringNode;
}

/** Visits url() inside a function node. Returns true if the node was changed. */
function visitUrlFunction(node: valueParser.FunctionNode, source: CssRefSource, visit: CssVisitor): boolean {
  const inner = node.nodes[0];
  if (!inner || (inner.type !== 'string' && inner.type !== 'word')) return false;
  const next = visit(inner.value, source);
  if (next === undefined || next === inner.value) return false;
  node.nodes = [stringNode(next)];
  return true;
}

/**
 * Single CSS URL walker used by both extraction and rewriting.
 * Covers url(), image-set()/-webkit-image-set() strings and @import. If nothing changes, the input string
 * is returned as-is (byte-identical).
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
      const next = visit(first.value, 'css-import');
      if (next !== undefined && next !== first.value) {
        first.value = next;
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
          const next = visit(child.value, 'css-url');
          if (next !== undefined && next !== child.value) {
            child.value = next;
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
