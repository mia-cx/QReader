import { Effect } from 'effect';
import { type FetchLike, fetchText } from './fetch.js';
import { extractPageLinks } from './html.js';
import type { SourcePage } from './page.js';

interface ResolveSourcePagesEnv {
  readonly fetchImpl: FetchLike;
  readonly log: (line: string) => void;
}

interface ResolveSourcePagesState {
  readonly seenPages: Set<string>;
  readonly yieldedLeaves: Set<string>;
}

export const resolveSourcePagesEffect = (
  page: SourcePage,
  env: ResolveSourcePagesEnv,
  state: ResolveSourcePagesState,
  depth = 0,
): AsyncGenerator<SourcePage> => {
  return (async function* () {
    const yieldLeaf = async function* (leaf: SourcePage): AsyncGenerator<SourcePage> {
      if (state.yieldedLeaves.has(leaf.url)) {
        return;
      }

      state.yieldedLeaves.add(leaf.url);
      env.log(`Source page ready ${leaf.url}`);
      yield leaf;
    };

    if (state.seenPages.has(page.url) || depth >= 3) {
      yield* yieldLeaf(page);
      return;
    }

    state.seenPages.add(page.url);
    const pageLinks = extractPageLinks(page.url, page.html, depth === 0);
    if (pageLinks.length === 0) {
      yield* yieldLeaf(page);
      return;
    }

    env.log(`Walking ${pageLinks.length} page link(s) from ${page.url}`);

    for (const pageLink of pageLinks) {
      env.log(`Fetching page ${pageLink}`);
      let nextPage: SourcePage | null;
      try {
        nextPage = await Effect.runPromise(fetchText(pageLink, env.fetchImpl, true));
      } catch (error) {
        env.log(
          `Skipped page ${pageLink}: ${error instanceof Error ? error.message : String(error)}`,
        );
        nextPage = null;
      }

      if (nextPage === null) {
        continue;
      }

      for await (const leaf of resolveSourcePagesEffect(nextPage, env, state, depth + 1)) {
        yield leaf;
      }
    }
  })();
};
