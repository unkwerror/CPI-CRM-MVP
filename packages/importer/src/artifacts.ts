import { createContentFingerprint, normalizeExternalUrl } from '@cpi-crm/domain';

import { canonicalHeader, serializedCellText } from './cell.js';
import { deepFreeze } from './hash.js';
import type { JsonObject, SerializedCell, SourceRow } from './types.js';

export interface LegacyArtifactMaterial {
  readonly sourceRowHash: string;
  readonly sheetName: string;
  readonly rowNumber: number;
  readonly column: number;
  readonly address: string;
  readonly header: string;
  readonly normalizedHeader: string;
  readonly typeCode: 'PITCH_DECK' | 'OTHER';
  readonly contentType: 'EXTERNAL_URL' | 'TEXT';
  readonly externalUrl: string | null;
  readonly textContent: string | null;
  readonly contentFingerprint: string;
}

export function isLegacyArtifactMaterialHeader(header: string | null): boolean {
  if (header === null) return false;
  const normalized = canonicalHeader(header);
  return (
    normalized.includes('pitch deck') ||
    normalized.includes('презентац') ||
    normalized.includes('материал')
  );
}

export function extractLegacyArtifactMaterials(
  rows: readonly SourceRow[],
): readonly LegacyArtifactMaterial[] {
  const materials: LegacyArtifactMaterial[] = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      if (!isLegacyArtifactMaterialHeader(cell.header)) continue;
      const material = materialFromCell(row, cell);
      if (material !== null) materials.push(material);
    }
  }
  return deepFreeze(materials) as readonly LegacyArtifactMaterial[];
}

function materialFromCell(row: SourceRow, cell: SerializedCell): LegacyArtifactMaterial | null {
  const header = cell.header;
  if (header === null) return null;
  const normalizedHeader = canonicalHeader(header);
  const typeCode =
    normalizedHeader.includes('pitch deck') || normalizedHeader.includes('презентац')
      ? 'PITCH_DECK'
      : 'OTHER';

  if (cell.kind === 'hyperlink') {
    const externalUrl = normalizeExternalUrl(hyperlinkUrl(cell));
    return deepFreeze({
      sourceRowHash: row.rowHash,
      sheetName: row.sheetName,
      rowNumber: row.rowNumber,
      column: cell.column,
      address: cell.address,
      header,
      normalizedHeader,
      typeCode,
      contentType: 'EXTERNAL_URL',
      externalUrl,
      textContent: null,
      contentFingerprint: createContentFingerprint({ urls: [externalUrl] }),
    }) as LegacyArtifactMaterial;
  }

  if (cell.kind !== 'string') return null;
  const textContent = serializedCellText(cell).trim();
  if (textContent.length === 0) return null;
  return deepFreeze({
    sourceRowHash: row.rowHash,
    sheetName: row.sheetName,
    rowNumber: row.rowNumber,
    column: cell.column,
    address: cell.address,
    header,
    normalizedHeader,
    typeCode,
    contentType: 'TEXT',
    externalUrl: null,
    textContent,
    contentFingerprint: createContentFingerprint({ text: textContent }),
  }) as LegacyArtifactMaterial;
}

function hyperlinkUrl(cell: SerializedCell): string {
  if (cell.value === null || Array.isArray(cell.value) || typeof cell.value !== 'object') {
    throw new Error(`Legacy material hyperlink at ${cell.address} has no URL payload`);
  }
  const url = (cell.value as JsonObject).url;
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error(`Legacy material hyperlink at ${cell.address} has no URL`);
  }
  return url;
}
