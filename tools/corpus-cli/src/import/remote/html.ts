import { getPageLinkPatterns, normalizeHost } from './policy.js';

const absolutize = (baseUrl: string, value: string | null): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
};

const parseSrcset = (value: string, baseUrl: string): readonly string[] => {
  return value
    .split(',')
    .map((entry) => entry.trim().split(/\s+/, 1)[0] ?? '')
    .map((candidate) => absolutize(baseUrl, candidate))
    .filter((candidate): candidate is string => candidate !== null);
};

const dedupe = (values: readonly string[]): string[] => {
  return [...new Set(values)];
};

const matchAllGroups = (pattern: RegExp, value: string, groupIndex = 1): string[] => {
  if (!pattern.global) {
    throw new Error('matchAllGroups requires a global regular expression');
  }

  const matches: string[] = [];
  let match = pattern.exec(value);

  while (match !== null) {
    const candidate = match[groupIndex];
    if (candidate) {
      matches.push(candidate);
    }
    match = pattern.exec(value);
  }

  return matches;
};

export const detectBestEffortLicense = (
  host: string,
  html: string,
): { bestEffortLicense?: string; licenseEvidenceText?: string } => {
  const lowerHtml = html.toLowerCase();
  const evidenceMatch =
    /(public domain|cc0|pixabay license|pexels license|royalty free|free download|unsplash license)/i.exec(
      html,
    )?.[0];

  if (host === 'commons.wikimedia.org' || host === 'pdimagearchive.org') {
    return {
      bestEffortLicense: 'Public domain (host allowlisted; verify page)',
      ...(evidenceMatch ? { licenseEvidenceText: evidenceMatch } : {}),
    };
  }
  if (lowerHtml.includes('pixabay license')) {
    return {
      bestEffortLicense: 'Pixabay License',
      ...(evidenceMatch ? { licenseEvidenceText: evidenceMatch } : {}),
    };
  }
  if (lowerHtml.includes('pexels license')) {
    return {
      bestEffortLicense: 'Pexels License',
      ...(evidenceMatch ? { licenseEvidenceText: evidenceMatch } : {}),
    };
  }
  if (lowerHtml.includes('royalty free') || lowerHtml.includes('free download')) {
    return {
      bestEffortLicense: 'Royalty free / free download (verify page)',
      ...(evidenceMatch ? { licenseEvidenceText: evidenceMatch } : {}),
    };
  }
  if (host === 'unsplash.com') {
    return {
      bestEffortLicense: 'Unsplash / free to use (verify page)',
      ...(evidenceMatch ? { licenseEvidenceText: evidenceMatch } : {}),
    };
  }
  if (evidenceMatch) {
    return { licenseEvidenceText: evidenceMatch };
  }
  return {};
};

export const extractMetaImageCandidates = (pageUrl: string, html: string): readonly string[] => {
  return dedupe(
    [
      ...matchAllGroups(
        /<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["'][^>]*>/gi,
        html,
      ),
      ...matchAllGroups(
        /<link\b[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
        html,
      ),
    ]
      .map((value) => absolutize(pageUrl, value))
      .filter((candidate): candidate is string => candidate !== null),
  );
};

export const extractInlineImageCandidates = (pageUrl: string, html: string): readonly string[] => {
  return dedupe(
    [
      ...matchAllGroups(/<(?:img|source)\b[^>]*src=["']([^"']+)["'][^>]*>/gi, html),
      ...matchAllGroups(/<(?:img|source)\b[^>]*srcset=["']([^"']+)["'][^>]*>/gi, html).flatMap(
        (srcset) => parseSrcset(srcset, pageUrl),
      ),
    ]
      .map((value) => absolutize(pageUrl, value))
      .filter((candidate): candidate is string => candidate !== null),
  );
};

const normalizePageLinks = (pageUrl: string, matches: readonly string[]): readonly string[] => {
  const baseUrl = new URL(pageUrl);
  const host = normalizeHost(baseUrl.hostname);
  const patterns = getPageLinkPatterns(host);
  if (patterns.length === 0) return [];

  return dedupe(
    matches
      .map((href) => absolutize(pageUrl, href))
      .filter((href): href is string => href !== null)
      .filter((href) => normalizeHost(new URL(href).hostname) === host)
      .filter((href) => patterns.some((pattern) => pattern.test(new URL(href).pathname))),
  );
};

const extractWrappedPageLinks = (
  pageUrl: string,
  html: string,
): readonly { href: string; imageCandidates: readonly string[] }[] => {
  const baseUrl = new URL(pageUrl);
  const host = normalizeHost(baseUrl.hostname);
  const patterns = getPageLinkPatterns(host);
  if (patterns.length === 0) return [];

  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      href: absolutize(pageUrl, match[1] ?? ''),
      imageCandidates: extractInlineImageCandidates(pageUrl, match[2] ?? ''),
    }))
    .filter(
      (
        match,
      ): match is {
        href: string;
        imageCandidates: readonly string[];
      } => match.href !== null,
    )
    .filter((match) => match.imageCandidates.length > 0)
    .filter((match) => normalizeHost(new URL(match.href).hostname) === host)
    .filter((match) => patterns.some((pattern) => pattern.test(new URL(match.href).pathname)));
};

export const extractPageLinks = (
  pageUrl: string,
  html: string,
  allowFanOut: boolean,
): readonly string[] => {
  const wrappedLinks = extractWrappedPageLinks(pageUrl, html);
  const metaImageCandidates = extractMetaImageCandidates(pageUrl, html);

  if (wrappedLinks.length === 0) {
    if (!allowFanOut) {
      return [];
    }

    return extractInlineImageCandidates(pageUrl, html).length === 0
      ? normalizePageLinks(pageUrl, matchAllGroups(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi, html))
      : [];
  }

  if (metaImageCandidates.length > 0) {
    const metaMatchingWraps = wrappedLinks.filter((link) =>
      link.imageCandidates.some((candidate) => metaImageCandidates.includes(candidate)),
    );

    if (metaMatchingWraps.length > 0) {
      return normalizePageLinks(pageUrl, dedupe(metaMatchingWraps.map((link) => link.href)));
    }

    if (!allowFanOut) {
      return [];
    }
  }

  if (!allowFanOut) {
    return [];
  }

  return normalizePageLinks(pageUrl, dedupe(wrappedLinks.map((link) => link.href)));
};

export const extractImageCandidates = (
  pageUrl: string,
  html: string,
  isDetail: boolean,
): readonly string[] => {
  const metaCandidates = extractMetaImageCandidates(pageUrl, html);

  if (isDetail && metaCandidates.length > 0) {
    return metaCandidates;
  }

  const inlineCandidates = extractInlineImageCandidates(pageUrl, html);
  if (isDetail) {
    return inlineCandidates;
  }

  return dedupe([...metaCandidates, ...inlineCandidates]);
};
