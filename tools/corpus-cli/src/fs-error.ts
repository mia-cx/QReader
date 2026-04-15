export const isEnoentError = (error: unknown): boolean => {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
};
