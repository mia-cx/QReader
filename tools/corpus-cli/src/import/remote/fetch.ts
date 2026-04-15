import { Effect } from 'effect';
import { tryPromise } from './effect.js';
import type { SourcePage } from './page.js';
import { normalizeHost } from './policy.js';
import { htmlToText } from './text.js';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_SAME_HOST_REDIRECTS = 5;

// Send a browser-like request so sites that gate on UA/headers don't 403 us.
// Corpus acquisition is manual/interactive, not mass automated scraping.
const BROWSER_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
};

const readLimitedBody = (response: Response, maxBytes: number, label: string) => {
  return tryPromise(async () => {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`Response for ${label} exceeds ${maxBytes} bytes`);
    }

    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) {
        throw new Error(`Response for ${label} exceeds ${maxBytes} bytes`);
      }
      return bytes;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          throw new Error(`Response for ${label} exceeds ${maxBytes} bytes`);
        }
        chunks.push(chunk);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // cancel may fail if the stream is already closed
      }
      reader.releaseLock();
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  });
};

const assertSameHostRedirect = (from: string, to: string): void => {
  const fromUrl = new URL(from);
  const toUrl = new URL(to);
  if (normalizeHost(fromUrl.hostname) !== normalizeHost(toUrl.hostname)) {
    throw new Error(`Cross-host redirect not allowed: ${from} -> ${to}`);
  }
  if (fromUrl.protocol === 'https:' && toUrl.protocol !== 'https:') {
    throw new Error(`Protocol downgrade not allowed: ${from} -> ${to}`);
  }
};

export const fetchFollowingSameHost = (
  url: string,
  fetchImpl: FetchLike,
  accept: string,
  label: string,
) => {
  return tryPromise(async () => {
    let currentUrl = url;
    for (let hop = 0; hop <= MAX_SAME_HOST_REDIRECTS; hop += 1) {
      const response = await fetchImpl(currentUrl, {
        headers: { ...BROWSER_HEADERS, accept },
        redirect: 'manual',
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Redirect without location while fetching ${label} ${currentUrl}`);
        }

        const nextUrl = new URL(location, currentUrl).toString();
        assertSameHostRedirect(currentUrl, nextUrl);
        currentUrl = nextUrl;
        continue;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch ${label} ${currentUrl}: ${response.status}`);
      }

      return { response, finalUrl: currentUrl };
    }

    throw new Error(`Too many redirects while fetching ${label} ${url}`);
  });
};

export const fetchText = (url: string, fetchImpl: FetchLike, isDetail: boolean) => {
  return Effect.gen(function* () {
    const { response, finalUrl } = yield* fetchFollowingSameHost(
      url,
      fetchImpl,
      'text/html,application/xhtml+xml',
      'page',
    );

    const htmlBytes = yield* readLimitedBody(response, MAX_HTML_BYTES, `page ${finalUrl}`);
    const html = new TextDecoder().decode(htmlBytes);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;

    return {
      url: finalUrl,
      title,
      html,
      isDetail,
    } satisfies SourcePage;
  });
};

// ── Wikimedia Commons structured metadata ─────────────────────────────

export interface CommonsFileMeta {
  readonly license?: string;
  readonly attribution?: string;
}

/**
 * Fetches structured file metadata from the Wikimedia Commons `imageinfo` API.
 * Returns null on any error so callers can gracefully fall back to HTML parsing.
 */
export const fetchCommonsFileMeta = async (
  pageUrl: string,
  fetchImpl: FetchLike,
): Promise<CommonsFileMeta | null> => {
  const match = /\/wiki\/(File:[^?#]+)/i.exec(pageUrl);
  if (!match?.[1]) return null;

  const title = decodeURIComponent(match[1]);
  const apiUrl =
    `https://commons.wikimedia.org/w/api.php?action=query` +
    `&titles=${encodeURIComponent(title)}` +
    `&prop=imageinfo&iiprop=extmetadata&format=json&origin=*`;

  const MAX_API_BYTES = 1 * 1024 * 1024;

  try {
    const response = await fetchImpl(apiUrl, {
      headers: { ...BROWSER_HEADERS, accept: 'application/json' },
    });
    if (!response.ok) return null;

    const bodyBytes = await Effect.runPromise(
      readLimitedBody(response, MAX_API_BYTES, 'Wikimedia API'),
    );
    const data = JSON.parse(new TextDecoder().decode(bodyBytes)) as {
      query?: {
        pages?: Record<
          string,
          {
            imageinfo?: Array<{ extmetadata?: Record<string, { value?: string }> }>;
          }
        >;
      };
    };

    const extmeta = Object.values(data?.query?.pages ?? {})[0]?.imageinfo?.[0]?.extmetadata;
    if (!extmeta) return null;

    const license = extmeta.LicenseShortName?.value?.trim() || undefined;
    const artistRaw = extmeta.Artist?.value;
    const attribution = artistRaw ? htmlToText(artistRaw) || undefined : undefined;

    return {
      ...(license ? { license } : {}),
      ...(attribution ? { attribution } : {}),
    };
  } catch {
    return null;
  }
};

export const fetchImage = (url: string, fetchImpl: FetchLike) => {
  return Effect.gen(function* () {
    const { response, finalUrl } = yield* fetchFollowingSameHost(
      url,
      fetchImpl,
      'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.1',
      'image',
    );

    const bytes = yield* readLimitedBody(response, MAX_IMAGE_BYTES, `image ${finalUrl}`);
    return {
      bytes,
      mediaType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  });
};
