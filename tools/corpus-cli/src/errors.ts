/** Tagged error for filesystem I/O failures. */
export class FilesystemError extends Error {
  readonly _tag = 'FilesystemError';
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FilesystemError';
  }
}

/** Tagged error for network fetch failures. */
export class FetchError extends Error {
  readonly _tag = 'FetchError';
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

/** Tagged error for schema/JSON parse failures. */
export class ParseError extends Error {
  readonly _tag = 'ParseError';
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

/** Tagged error for unsupported media type or file extension. */
export class UnsupportedMediaError extends Error {
  readonly _tag = 'UnsupportedMediaError';
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'UnsupportedMediaError';
  }
}

/** Tagged error for image processing failures (sharp). */
export class ImageProcessingError extends Error {
  readonly _tag = 'ImageProcessingError';
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ImageProcessingError';
  }
}

/** Tagged error for corpus data integrity violations (e.g. conflicting dedup). */
export class CorpusIntegrityError extends Error {
  readonly _tag = 'CorpusIntegrityError';
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CorpusIntegrityError';
  }
}

/** Tagged error for policy/validation violations (e.g. disallowed host). */
export class PolicyError extends Error {
  readonly _tag = 'PolicyError';
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PolicyError';
  }
}

/** Union of all corpus-cli domain errors. */
export type CorpusError =
  | FilesystemError
  | FetchError
  | ParseError
  | UnsupportedMediaError
  | ImageProcessingError
  | CorpusIntegrityError
  | PolicyError;
