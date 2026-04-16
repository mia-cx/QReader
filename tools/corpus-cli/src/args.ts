import type { CorpusAssetLabel, ReviewStatus } from './schema.js';

/** Names of the top-level CLI subcommands. */
export type CommandName = 'scrape' | 'review' | 'import' | 'build-bench';

/** Structured result of parsing raw process.argv arguments. */
export interface ParsedArgs {
  readonly command?: CommandName;
  readonly positionals: readonly string[];
  readonly options: Readonly<Record<string, string | true>>;
  readonly help: boolean;
  readonly verbose: boolean;
}

const COMMAND_NAMES = new Set<CommandName>(['scrape', 'review', 'import', 'build-bench']);

/** Parse a raw argv array (without the node/bun executable prefix) into structured args. */
export const parseArgv = (argv: readonly string[]): ParsedArgs => {
  const rest = [...argv];
  const first = rest[0];
  const command =
    first && COMMAND_NAMES.has(first as CommandName) ? (rest.shift() as CommandName) : undefined;
  const options: Record<string, string | true> = {};
  const positionals: string[] = [];
  let verbose = false;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token) {
      continue;
    }

    if (token === '--help' || token === '-h') {
      return {
        ...(command ? { command } : {}),
        positionals,
        options,
        help: true,
        verbose,
      };
    }

    if (token === '--verbose' || token === '-v') {
      verbose = true;
      continue;
    }

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const name = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      options[name] = true;
      continue;
    }

    options[name] = next;
    index += 1;
  }

  return {
    ...(command ? { command } : {}),
    positionals,
    options,
    help: false,
    verbose,
  };
};

/** Return the string value of a named `--flag value` option, or `undefined` if absent or boolean. */
export const getOption = (args: ParsedArgs, name: string): string | undefined => {
  const value = args.options[name];
  return typeof value === 'string' ? value : undefined;
};

/** Parse and validate a `--label` option value; throws on invalid input. */
export const parseLabel = (value: string | undefined): CorpusAssetLabel => {
  if (value === 'qr-positive' || value === 'non-qr-negative') {
    return value;
  }

  throw new Error('Expected --label qr-positive|non-qr-negative');
};

/** Parse and validate a `--review` option value; throws on invalid input. */
export const parseReviewStatus = (value: string | undefined): ReviewStatus => {
  if (value === 'pending' || value === 'approved' || value === 'rejected') {
    return value;
  }

  throw new Error('Expected --review pending|approved|rejected');
};

/** Parse an optional `--review` option; returns `undefined` when value is absent. */
export const parseOptionalReviewStatus = (value: string | undefined): ReviewStatus | undefined => {
  return value ? parseReviewStatus(value) : undefined;
};

/** Parse a `--limit` option string into a positive finite number; throws on invalid input. */
export const parseLimit = (value: string | undefined): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Expected --limit to be a positive integer');
  }
  return parsed;
};
