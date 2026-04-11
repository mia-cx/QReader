import { Effect } from 'effect';

export const tryPromise = <A>(evaluate: () => Promise<A>) => {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
};
