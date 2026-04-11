import type { Option } from '@clack/prompts';
import * as p from '@clack/prompts';
import {
  CliCancelledError,
  type CliUi,
  type ConfirmPromptOptions,
  type SelectPromptOptions,
  type SelectValue,
  type TextPromptOptions,
} from '../ui.js';

const unwrap = <T>(value: T | symbol): T => {
  if (p.isCancel(value)) {
    throw new CliCancelledError();
  }

  return value as T;
};

export const createClackUi = (): CliUi => {
  return {
    intro(message) {
      p.intro(message);
    },
    outro(message) {
      p.outro(message);
    },
    cancel(message) {
      p.cancel(message);
    },
    info(message) {
      console.log(message);
    },
    warn(message) {
      console.warn(message);
    },
    async text(options: TextPromptOptions): Promise<string> {
      return unwrap(
        await p.text({
          message: options.message,
          ...(options.placeholder ? { placeholder: options.placeholder } : {}),
          ...(options.initialValue ? { initialValue: options.initialValue } : {}),
          ...(options.validate ? { validate: options.validate } : {}),
        }),
      );
    },
    async confirm(options: ConfirmPromptOptions): Promise<boolean> {
      return unwrap(
        await p.confirm({
          message: options.message,
          ...(options.initialValue !== undefined ? { initialValue: options.initialValue } : {}),
        }),
      );
    },
    async select<T extends SelectValue>(options: SelectPromptOptions<T>): Promise<T> {
      const promptOptions: Option<T>[] = [];
      for (const option of options.options) {
        if (option.hint) {
          promptOptions.push({
            value: option.value,
            label: option.label,
            hint: option.hint,
          } as Option<T>);
        } else {
          promptOptions.push({ value: option.value, label: option.label } as Option<T>);
        }
      }

      return unwrap(
        await p.select({
          message: options.message,
          ...(options.initialValue !== undefined ? { initialValue: options.initialValue } : {}),
          options: promptOptions,
        }),
      );
    },
    async spin<T>(message: string, task: () => Promise<T>): Promise<T> {
      const spinner = p.spinner();
      spinner.start(message);

      try {
        const result = await task();
        spinner.stop(message);
        return result;
      } catch (error) {
        spinner.stop(`${message} failed`);
        throw error;
      }
    },
  };
};
