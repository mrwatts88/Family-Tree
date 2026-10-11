/**
 * Minimal, lossless GEDCOM 5.5.1 reader. Every line, including Ancestry's
 * custom `_` tags, ends up as a node, so nothing in the export is dropped.
 */
export interface GedNode {
  level: number;
  xref?: string;
  tag: string;
  value: string;
  children: GedNode[];
}

const LINE_RE = /^\s*(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/;

export function parseGedcom(text: string): GedNode[] {
  const roots: GedNode[] = [];
  const stack: GedNode[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);

  for (const [i, raw] of lines.entries()) {
    if (!raw.trim()) continue;
    const m = LINE_RE.exec(raw);
    if (!m) throw new Error(`GEDCOM line ${i + 1} is malformed: ${raw.slice(0, 80)}`);
    const level = Number(m[1]);
    const node: GedNode = { level, tag: m[3].toUpperCase(), value: m[4] ?? "", children: [] };
    if (m[2]) node.xref = m[2];

    // CONT/CONC continue the parent's value rather than adding a child.
    if (node.tag === "CONT" || node.tag === "CONC") {
      const parent = stack[level - 1];
      if (parent) {
        parent.value += (node.tag === "CONT" ? "\n" : "") + node.value;
        continue;
      }
    }

    stack.length = level;
    if (level === 0) roots.push(node);
    else {
      const parent = stack[level - 1];
      if (!parent) throw new Error(`GEDCOM line ${i + 1} skips a level`);
      parent.children.push(node);
    }
    stack[level] = node;
  }
  return roots;
}

export function child(node: GedNode, tag: string): GedNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

export function children(node: GedNode, tag: string): GedNode[] {
  return node.children.filter((c) => c.tag === tag);
}

export function childValue(node: GedNode, tag: string): string | undefined {
  const v = child(node, tag)?.value.trim();
  return v ? v : undefined;
}

/** Plain-object form for storing the full record as JSON. */
export function toJson(node: GedNode): unknown {
  return {
    tag: node.tag,
    ...(node.xref ? { xref: node.xref } : {}),
    ...(node.value ? { value: node.value } : {}),
    ...(node.children.length ? { children: node.children.map(toJson) } : {}),
  };
}
