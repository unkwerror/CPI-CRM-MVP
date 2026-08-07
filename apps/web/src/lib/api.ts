export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as {
      title?: string;
      detail?: string;
    } | null;
    throw new ApiError(problem?.title ?? 'Ошибка запроса', response.status, problem?.detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Достаёт человекочитаемый текст из ProblemDetails, брошенного `api`. */
export function apiErrorMessage(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError)
    return caught.detail ? `${caught.message}: ${caught.detail}` : caught.message;
  return caught instanceof Error ? caught.message : fallback;
}

export function formatDate(value?: string | null, withTime = false): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(value));
}

export function formatMoney(value: number, currency = 'RUB'): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatBytes(value?: number | null): string {
  if (value === null || value === undefined) return '—';
  if (value < 1024) return `${value} Б`;
  const units = ['КБ', 'МБ', 'ГБ'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}
