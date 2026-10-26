/** Plain text for meta tags: no HTML, no control characters, single spaces. */
export function cleanText(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001F\u007F‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Shortens at a word boundary and marks the cut with an ellipsis. Never returns more than `max` characters. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = max - 1;
  const cut = text.slice(0, room);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > room * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s،,.;:؛\-–—]+$/u, "")}…`;
}
