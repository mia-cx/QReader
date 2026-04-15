const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&nbsp;': ' ',
};
const ENTITY_PATTERN = /&(?:amp|lt|gt|quot|nbsp|#039);/g;

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes requires matching control chars
const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;

/** Strips ANSI escape sequences from text. */
export const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, '');

/** Strips HTML tags and decodes common entities in a single pass (no double-decode). */
export const htmlToText = (fragment: string): string =>
  fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(ENTITY_PATTERN, (entity) => ENTITY_MAP[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
