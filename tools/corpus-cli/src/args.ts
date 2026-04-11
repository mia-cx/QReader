import type { CorpusAssetLabel, ReviewStatus } from './schema.js';

export type CommandName = 'scrape' | 'review' | 'import' | 'build-bench';

export interface ParsedArgs {
  readonly command?: CommandName;
  readonly positionals: readonly string[];
  readonly options: Readonly<Record<string, string | true>>;
  readonly help: boolean;
}

const COMMAND_NAMES = new Set<CommandName>(['scrape', 'review', 'import', 'build-bench']);

export const parseArgv = (argv: readonly string[]): ParsedArgs => {
  const rest = [...argv];
  const first = rest[0];
  const command =
    first && COMMAND_NAMES.has(first as CommandName) ? (rest.shift() as CommandName) : undefined;
  const options: Record<string, string | true> = {};
  const positionals: string[] = [];

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
      };
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
  };
};

export const getOption = (args: ParsedArgs, name: string): string | undefined => {
  const value = args.options[name];
  return typeof value === 'string' ? value : undefined;
};

export const parseLabel = (value: string | undefined): CorpusAssetLabel => {
  if (value === 'qr-positive' || value === 'non-qr-negative') {
    return value;
  }

  throw new Error('Expected --label qr-positive|non-qr-negative');
};

export const parseReviewStatus = (value: string | undefined): ReviewStatus => {
  if (value === 'pending' || value === 'approved' || value === 'rejected') {
    return value;
  }

  throw new Error('Expected --review pending|approved|rejected');
};

export const parseOptionalReviewStatus = (value: string | undefined): ReviewStatus | undefined => {
  return value ? parseReviewStatus(value) : undefined;
};

export const parseLimit = (value: string | undefined): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Expected --limit to be a positive number');
  }
  return parsed;
};
