import { Effect } from 'effect';
import { tryPromise } from './effect.js';
import type { SourcePage } from './page.js';
import { normalizeHost } from './policy.js';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_SAME_HOST_REDIRECTS = 5;

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
  if (normalizeHost(new URL(from).hostname) !== normalizeHost(new URL(to).hostname)) {
    throw new Error(`Cross-host redirect not allowed: ${from} -> ${to}`);
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
        headers: { accept },
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
