/**
 * Normalize a URL for dedup comparison via `URL` scheme/host canonicalization.
 * Falls back to the raw string if the input is not a valid URL (e.g. a relative path).
 */
export const normalizeUrlForDedup = (url: string): string => {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
};

/** Assert that `value` is a valid HTTP or HTTPS URL; throws a descriptive error otherwise. */
export const assertHttpUrl = (value: string, label: string): void => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid URL for ${label}: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Expected http(s) URL for ${label}, got ${url.protocol}`);
  }
};
