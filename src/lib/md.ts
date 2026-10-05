// Notes are written by people, so they're shown with a small, safe subset of Markdown:
// paragraphs, line breaks, *italic*, **bold** and [links](https://…). Everything else is plain text.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function inline(text: string) {
  let s = esc(text);
  s = s.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)/g, (_, label, url) =>
    `<a href="${url}" target="_blank" rel="noopener nofollow ugc">${label}</a>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  return s;
}

/** notes → safe HTML paragraphs */
export function md(text: string | null | undefined): string {
  const src = (text ?? '').replace(/\r\n/g, '\n').trim();
  if (!src) return '';
  return src.split(/\n{2,}/).map((p) => `<p>${inline(p.replace(/^#+\s*/, '').replace(/^>\s?/gm, '')).replace(/\n/g, '<br />')}</p>`).join('');
}
