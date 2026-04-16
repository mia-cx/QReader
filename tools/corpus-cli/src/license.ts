/**
 * Classifies a license string by its permissiveness for corpus use.
 *
 * - permissive:     can include in corpus without restriction
 * - non-commercial: free for non-commercial use only; reviewer decides
 * - restricted:     all rights reserved / proprietary — auto-reject
 * - unknown:        not enough information; reviewer decides
 */
export type LicensePermissiveness = 'permissive' | 'non-commercial' | 'restricted' | 'unknown';

/** Classify a license string by its permissiveness for corpus use. */
export const classifyLicense = (license: string): LicensePermissiveness => {
  const s = license.toLowerCase().trim();

  // Unambiguously permissive
  if (/public[\s-]?domain|cc\s*0/.test(s)) return 'permissive';
  if (/pixabay\s+license|pexels\s+license|unsplash\s+license/.test(s)) return 'permissive';

  // CC licenses — permissive unless NC is present
  if (/\bcc[\s-]by\b/.test(s)) {
    if (/-nc\b|non[\s-]?commercial/.test(s)) return 'non-commercial';
    if (/-nd\b|no[\s-]?deriv/.test(s)) return 'restricted';
    return 'permissive';
  }
  // CC0 written out
  if (/creative\s+commons\s+zero/.test(s)) return 'permissive';

  // Clearly non-commercial
  if (/non[\s-]?commercial/.test(s)) return 'non-commercial';

  // Clearly restricted
  if (/all\s+rights?\s+reserved/.test(s)) return 'restricted';
  if (/no\s+redistribution|not\s+for\s+redistribution/.test(s)) return 'restricted';
  if (/proprietary/.test(s)) return 'restricted';
  if (/(©|\bcopyright)\s*\d{4}/.test(s) && !/\blicense\b/.test(s)) return 'restricted';

  return 'unknown';
};

/** Return `true` if the license string should trigger automatic rejection (restricted). */
export const isAutoRejectLicense = (license: string): boolean =>
  classifyLicense(license) === 'restricted';
