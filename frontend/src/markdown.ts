export function markdownParts(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  return match
    ? {
        body: text.slice(match[0].length),
        frontmatter: match[1],
        offset: match[0].split('\n').length - 1,
      }
    : { body: text, frontmatter: '', offset: 0 };
}
export function outline(text: string) {
  const result: { line: number; level: number; title: string }[] = [];
  const { body, offset } = markdownParts(text);
  let fence: { character: string; length: number } | null = null;
  for (const [i, line] of body.split('\n').entries()) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (delimiter) {
      if (!fence) fence = { character: delimiter[1][0], length: delimiter[1].length };
      else if (
        delimiter[1][0] === fence.character &&
        delimiter[1].length >= fence.length &&
        !delimiter[2].trim()
      )
        fence = null;
      continue;
    }
    const match = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) result.push({ line: i + offset + 1, level: match[1].length, title: match[2] });
    if (result.length >= 1000) break;
  }
  return result;
}
export function remarkWikiLinks() {
  type Ast = { type: string; value?: string; url?: string; children?: Ast[] };
  return (tree: Ast) => {
    const visit = (node: Ast) => {
      if (!node.children) return;
      const next: Ast[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && child.value) {
          const value = child.value,
            pattern = /!?\[\[([^\]\n]+)\]\]/g;
          let cursor = 0;
          for (const match of value.matchAll(pattern)) {
            if (match.index! > cursor)
              next.push({ type: 'text', value: value.slice(cursor, match.index) });
            const target = match[1],
              label = target.includes('|')
                ? target.split('|').slice(1).join('|')
                : target.replace(/#.+$/, '').split('/').at(-1) || target;
            next.push({
              type: 'link',
              url: 'atlas-note:' + encodeURIComponent(target),
              children: [{ type: 'text', value: label }],
            });
            cursor = match.index! + match[0].length;
          }
          if (cursor < value.length) next.push({ type: 'text', value: value.slice(cursor) });
        } else {
          if (!['code', 'inlineCode', 'link'].includes(child.type)) visit(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    visit(tree);
  };
}
