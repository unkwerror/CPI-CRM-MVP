/**
 * Оценка артефакта ЦПИ.
 *
 * Ревьюер принимает одно решение — «принят» или «не принят» — и ставит
 * субъективный балл качества от 1 до 10. Качественным считается принятый артефакт;
 * балл используется как метрика уровня, а не как порог приёмки.
 *
 * Рубрикатор из пяти критериев по 0–2 больше не заполняется, но остаётся
 * ниже: по нему разбираются ревью, созданные до упрощения шкалы.
 */

export type ArtifactReviewDecision = 'ACCEPTED' | 'REJECTED' | 'NEEDS_REVISION';

export const ARTIFACT_SCORE_MIN = 1;
export const ARTIFACT_SCORE_MAX = 10;

/** Принятый артефакт — качественный. Балл на приёмку не влияет. */
export function isQualityArtifact(decision: ArtifactReviewDecision | null | undefined): boolean {
  return decision === 'ACCEPTED';
}

/** @deprecated Исторический рубрикатор: только для чтения старых ревью. */
export const ARTIFACT_QUALITY_CRITERIA = [
  {
    code: 'relevance',
    label: 'Релевантность',
    blocking: true,
    hint: 'Отвечает задаче мероприятия, проекта, продукта или партнёрского запроса. 0 блокирует приёмку.',
  },
  {
    code: 'completeness',
    label: 'Полнота',
    blocking: false,
    hint: 'Содержания достаточно, чтобы понять и использовать без устных пояснений автора.',
  },
  {
    code: 'verifiability',
    label: 'Проверяемость',
    blocking: true,
    hint: 'Есть доказательство выполнения: ссылка, файл, код, расчёт, демо. 0 блокирует приёмку.',
  },
  {
    code: 'applicability',
    label: 'Потенциал применения',
    blocking: false,
    hint: 'Можно использовать дальше: в проекте, продукте, продаже или методологии.',
  },
  {
    code: 'timeliness',
    label: 'Срок и формат',
    blocking: false,
    hint: 'Сдан в согласованный срок и в формате, который можно хранить и переиспользовать.',
  },
] as const;

export type ArtifactCriterionCode = (typeof ARTIFACT_QUALITY_CRITERIA)[number]['code'];

export type ArtifactCriteriaScores = Readonly<Record<ArtifactCriterionCode, 0 | 1 | 2>>;

/** Балл, начиная с которого артефакт считается сильным в отчётности. */
export const QUALITY_ARTIFACT_THRESHOLD = 7;

export class ArtifactCriteriaValidationError extends TypeError {
  public readonly code = 'INVALID_ARTIFACT_CRITERIA';

  public constructor(message: string) {
    super(message);
    this.name = 'ArtifactCriteriaValidationError';
  }
}

/**
 * Разбирает и валидирует критерии из произвольного ввода (каждый — целое 0–2).
 *
 * @deprecated Исторический рубрикатор: только для чтения старых ревью.
 */
export function parseArtifactCriteria(value: unknown): ArtifactCriteriaScores {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ArtifactCriteriaValidationError('Критерии оценки должны быть объектом');
  }
  const record = value as Record<string, unknown>;
  const result: Partial<Record<ArtifactCriterionCode, 0 | 1 | 2>> = {};
  for (const criterion of ARTIFACT_QUALITY_CRITERIA) {
    const raw = record[criterion.code];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 2) {
      throw new ArtifactCriteriaValidationError(
        `Критерий «${criterion.label}» должен быть целым числом от 0 до 2`,
      );
    }
    result[criterion.code] = raw as 0 | 1 | 2;
  }
  const extraKeys = Object.keys(record).filter(
    (key) => !ARTIFACT_QUALITY_CRITERIA.some((criterion) => criterion.code === key),
  );
  if (extraKeys.length > 0) {
    throw new ArtifactCriteriaValidationError(`Неизвестные критерии: ${extraKeys.join(', ')}`);
  }
  return result as ArtifactCriteriaScores;
}

/**
 * Q_artifact = сумма пяти критериев (0–10).
 *
 * @deprecated Исторический рубрикатор: только для чтения старых ревью.
 */
export function computeArtifactScore(criteria: ArtifactCriteriaScores): number {
  return ARTIFACT_QUALITY_CRITERIA.reduce((sum, criterion) => sum + criteria[criterion.code], 0);
}
