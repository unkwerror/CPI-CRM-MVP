/**
 * Рубрикатор качества ЦПИ («ЦПИ: метрики и рабочие определения», июль 2026).
 *
 * Артефакт оценивается по пяти критериям 0–2; Q_artifact — их сумма (0–10).
 * Качественный артефакт: Q_artifact >= 7 и нет нуля по блокирующим критериям
 * «релевантность» и «проверяемость».
 */

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

export const QUALITY_ARTIFACT_THRESHOLD = 7;

export class ArtifactCriteriaValidationError extends TypeError {
  public readonly code = 'INVALID_ARTIFACT_CRITERIA';

  public constructor(message: string) {
    super(message);
    this.name = 'ArtifactCriteriaValidationError';
  }
}

/** Разбирает и валидирует критерии из произвольного ввода (каждый — целое 0–2). */
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

/** Q_artifact = сумма пяти критериев (0–10). */
export function computeArtifactScore(criteria: ArtifactCriteriaScores): number {
  return ARTIFACT_QUALITY_CRITERIA.reduce((sum, criterion) => sum + criteria[criterion.code], 0);
}

/**
 * Качественный артефакт. Для ревью без критериев (старая единая шкала)
 * действует только порог Q >= 7.
 */
export function isQualityArtifact(
  score: number | null,
  criteria: ArtifactCriteriaScores | null,
): boolean {
  if (score === null || score < QUALITY_ARTIFACT_THRESHOLD) return false;
  if (criteria === null) return true;
  return ARTIFACT_QUALITY_CRITERIA.every(
    (criterion) => !criterion.blocking || criteria[criterion.code] > 0,
  );
}

/**
 * Индекс качества головы: Q_head = 0.35 × качество артефактов +
 * 0.25 × регулярность + 0.20 × проектная включённость +
 * 0.20 × коммерческая применимость. Все компоненты нормированы к 100.
 */
export interface HeadQualityComponents {
  /** Средний Q_artifact за 90 дней, нормированный к 100. */
  readonly artifactQuality: number;
  /** Доля 30-дневных окон за последние 90 дней с качественным артефактом (0–100). */
  readonly regularity: number;
  /** Есть роль в команде/проекте, продукте, партнёрском запросе или продаже (0 или 100). */
  readonly projectInvolvement: number;
  /** Результат можно связать с партнёрским спросом или продуктом (0 или 100). */
  readonly commercialApplicability: number;
}

export const HEAD_QUALITY_WEIGHTS = {
  artifactQuality: 0.35,
  regularity: 0.25,
  projectInvolvement: 0.2,
  commercialApplicability: 0.2,
} as const;

export function computeHeadQuality(components: HeadQualityComponents): number {
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  return (
    HEAD_QUALITY_WEIGHTS.artifactQuality * clamp(components.artifactQuality) +
    HEAD_QUALITY_WEIGHTS.regularity * clamp(components.regularity) +
    HEAD_QUALITY_WEIGHTS.projectInvolvement * clamp(components.projectInvolvement) +
    HEAD_QUALITY_WEIGHTS.commercialApplicability * clamp(components.commercialApplicability)
  );
}

export type HeadQualityBand = 'READY' | 'ACTIVATED' | 'WEAK' | 'REACTIVATE';

export const HEAD_QUALITY_BAND_LABELS: Readonly<Record<HeadQualityBand, string>> = {
  READY: 'Готов к продаже или лидерству в проекте',
  ACTIVATED: 'Активирован, нужен трекинг',
  WEAK: 'Слабая активация',
  REACTIVATE: 'Кандидат на реактивацию или списание',
};

export function interpretHeadQuality(score: number): HeadQualityBand {
  if (score >= 80) return 'READY';
  if (score >= 60) return 'ACTIVATED';
  if (score >= 40) return 'WEAK';
  return 'REACTIVATE';
}
