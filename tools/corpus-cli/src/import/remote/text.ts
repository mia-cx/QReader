const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&nbsp;': ' ',
};
const ENTITY_PATTERN = /&(?:amp|lt|gt|quot|nbsp|#039);/g;

/** Strips HTML tags and decodes common entities in a single pass (no double-decode). */
export const htmlToText = (fragment: string): string =>
  fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(ENTITY_PATTERN, (entity) => ENTITY_MAP[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
