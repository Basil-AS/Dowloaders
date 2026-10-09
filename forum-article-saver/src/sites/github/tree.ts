/** Компактное дерево каталогов: отступ в два пробела, без псевдографики (она стоит лишних токенов). */
interface Node {
  dirs: Map<string, Node>;
  files: string[];
}

export function renderTree(paths: string[], rootName: string): string {
  const root: Node = { dirs: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let n = root;
    for (const d of parts.slice(0, -1)) {
      let c = n.dirs.get(d);
      if (!c) n.dirs.set(d, (c = { dirs: new Map(), files: [] }));
      n = c;
    }
    n.files.push(parts[parts.length - 1]!);
  }
  const lines = [`${rootName}/`];
  const walk = (n: Node, depth: number) => {
    const pad = '  '.repeat(depth);
    for (const [name, child] of [...n.dirs].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`${pad}${name}/`);
      walk(child, depth + 1);
    }
    for (const f of n.files.sort((a, b) => a.localeCompare(b))) lines.push(`${pad}${f}`);
  };
  walk(root, 1);
  return lines.join('\n');
}

/** Грубая оценка числа токенов (≈ 4 символа на токен для кода и английского текста). */
export const estimateTokens = (chars: number) => Math.ceil(chars / 4);

export function fmtTokens(n: number): string {
  if (n < 1000) return `~${n}`;
  if (n < 1_000_000) return `~${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `~${(n / 1_000_000).toFixed(1)}M`;
}
