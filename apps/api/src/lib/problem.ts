export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly type = 'about:blank',
  ) {
    super(detail ?? title);
    this.name = 'HttpProblem';
  }
}

export function assertFound<T>(value: T | null | undefined, detail = 'Ресурс не найден'): T {
  if (value === null || value === undefined) throw new HttpProblem(404, 'Не найдено', detail);
  return value;
}
