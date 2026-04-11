export const isInteractiveSession = (
  stdin: Pick<NodeJS.ReadStream, 'isTTY'> = process.stdin,
  stdout: Pick<NodeJS.WriteStream, 'isTTY'> = process.stdout,
): boolean => {
  return Boolean(stdin.isTTY && stdout.isTTY);
};

export const assertInteractiveSession = (message: string): void => {
  if (!isInteractiveSession()) {
    throw new Error(message);
  }
};
