import type { CliUi } from './ui.js';

export interface AppContext {
  readonly repoRoot: string;
  readonly ui: CliUi;
  readonly openTarget: (target: string) => Promise<void>;
  readonly detectGithubLogin: () => string | undefined;
}
