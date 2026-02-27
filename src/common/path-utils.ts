/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  Path segment parsing and building for path bar and context menus.
  Format-agnostic: path is a string; semantics are backend-defined.
  Used by webview (re-exported) and by Node tests.
*/

/**
 * Split a path string into segments, respecting [...] predicates (do not split on / inside brackets).
 * e.g. 'rpc-reply/data/port[port-id="1/1/c1/1"]/ethernet' → ['rpc-reply','data','port[port-id="1/1/c1/1"]','ethernet']
 */
export function splitPathSegments(pathStr: string): string[] {
  const segs: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of pathStr.replace(/^\/+/, '')) {
    if (ch === '[') {
      depth++;
      cur += ch;
    } else if (ch === ']') {
      depth--;
      cur += ch;
    } else if (ch === '/' && depth === 0) {
      if (cur) segs.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) segs.push(cur);
  return segs.filter(Boolean);
}

/** Format path predicate value; only quote when value contains ']' (would break segment). */
export function formatPathPredicateValue(value: string): string {
  if (value.includes(']') || value.includes('"')) {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return value;
}

/** Parse one path segment into name and predicates (e.g. "port[description=test][mtu=1500]" → { name, predicates }). */
export function parsePathSegment(
  seg: string
): { name: string; predicates: Array<{ key: string; value: string }> } {
  const trimmed = seg.trim();
  // [ in character class: escape required in JS so '[' is literal
  // eslint-disable-next-line no-useless-escape -- [ is literal in [^\[]+
  const match = trimmed.match(/^([^\[]+)(.*)$/);
  if (!match) return { name: trimmed, predicates: [] };
  const name = match[1].trim();
  const rest = match[2].trim();
  const predicates: Array<{ key: string; value: string }> = [];
  const keyRegex = /\[([^=]+)=([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = keyRegex.exec(rest)) !== null) {
    const rawVal = (m[2] ?? '').trim();
    const val = rawVal.replace(/^["']|["']$/g, '');
    predicates.push({ key: m[1].trim(), value: val });
  }
  return { name, predicates };
}

/** Build a segment string from name and predicates. */
export function buildPathSegment(
  name: string,
  predicates: Array<{ key: string; value: string }>
): string {
  if (predicates.length === 0) return name;
  return (
    name +
    predicates
      .map((p) => '[' + p.key + '=' + formatPathPredicateValue(p.value) + ']')
      .join('')
  );
}
