export interface Newsletter {
  title: string;
  message: string;
  editionDate: string;
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}
