export class CliCancelledError extends Error {
  constructor(message = 'Cancelled') {
    super(message);
    this.name = 'CliCancelledError';
  }
}

export interface TextPromptOptions {
  readonly message: string;
  readonly placeholder?: string;
  readonly initialValue?: string;
  readonly multiline?: boolean;
  readonly validate?: (value: string) => string | undefined;
}

export interface ConfirmPromptOptions {
  readonly message: string;
  readonly initialValue?: boolean;
}

export type SelectValue = string | number | boolean;

export interface SelectOption<T extends SelectValue> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

export interface SelectPromptOptions<T extends SelectValue> {
  readonly message: string;
  readonly initialValue?: T;
  readonly options: readonly SelectOption<T>[];
}

export interface CliUi {
  readonly verbose: boolean;
  intro(message: string): void;
  outro(message: string): void;
  cancel(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
  text(options: TextPromptOptions): Promise<string>;
  confirm(options: ConfirmPromptOptions): Promise<boolean>;
  select<T extends SelectValue>(options: SelectPromptOptions<T>): Promise<T>;
  spin<T>(message: string, task: () => Promise<T>): Promise<T>;
}
