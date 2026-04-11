export interface SourcePage {
  readonly url: string;
  readonly title: string | null;
  readonly html: string;
  readonly isDetail: boolean;
}
