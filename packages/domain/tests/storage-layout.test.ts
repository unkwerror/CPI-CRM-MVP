import { describe, expect, it } from 'vitest';

import {
  artifactObjectKey,
  campaignObjectKey,
  checkedObjectKey,
  incomingObjectKey,
  isInsideSection,
  sanitizeFileName,
  sanitizePathSegment,
  withCopySuffix,
} from '../src/storage-layout.js';

describe('раскладка общего хранилища', () => {
  it('разводит CRM и бот по верхним папкам', () => {
    expect(
      incomingObjectKey('crm/', {
        uploadId: '71a89421',
        fileName: 'отчёт.pdf',
        now: new Date('2026-08-14T10:00:00Z'),
      }),
    ).toBe('crm/incoming/2026-08-14/71a89421/отчёт.pdf');
    expect(
      incomingObjectKey('locker', {
        uploadId: '71a89421',
        fileName: 'отчёт.pdf',
        now: new Date('2026-08-14T10:00:00Z'),
      }),
    ).toBe('locker/incoming/2026-08-14/71a89421/отчёт.pdf');
  });

  it('кладёт артефакт в папку мероприятия и участника', () => {
    expect(
      artifactObjectKey('crm/', {
        eventName: 'Инвест-питч 04.2026',
        personName: 'Базарбаев Акмалжон Хуррамович',
        fileName: 'Презентация.pdf',
      }),
    ).toBe('crm/artifacts/Инвест-питч 04.2026/Базарбаев Акмалжон Хуррамович/Презентация.pdf');
  });

  it('подставляет понятные заглушки вместо пустых имён', () => {
    expect(artifactObjectKey('crm/', { eventName: null, personName: '   ', fileName: '' })).toBe(
      'crm/artifacts/Без мероприятия/Без участника/файл',
    );
  });

  it('вычищает символы, ломающие путь', () => {
    expect(sanitizePathSegment('Отчёт/за 2026: итоги')).toBe('Отчёт за 2026 итоги');
    expect(sanitizeFileName('..\\..\\секрет.pdf')).toBe('секрет.pdf');
    expect(sanitizeFileName('фото.JPEG')).toBe('фото.jpeg');
  });

  it('обрезает слишком длинное имя, сохраняя расширение', () => {
    const key = sanitizeFileName(`${'я'.repeat(200)}.pdf`);
    expect(key.endsWith('.pdf')).toBe(true);
    expect(key.length).toBeLessThanOrEqual(84);
  });

  it('разводит одинаковые имена суффиксом', () => {
    expect(withCopySuffix('crm/artifacts/Меро/Иванов/отчёт.pdf', 1)).toBe(
      'crm/artifacts/Меро/Иванов/отчёт.pdf',
    );
    expect(withCopySuffix('crm/artifacts/Меро/Иванов/отчёт.pdf', 2)).toBe(
      'crm/artifacts/Меро/Иванов/отчёт (2).pdf',
    );
    expect(withCopySuffix('crm/artifacts/Меро/Иванов/README', 3)).toBe(
      'crm/artifacts/Меро/Иванов/README (3)',
    );
  });

  it('отличает свой раздел от чужого', () => {
    const key = checkedObjectKey('crm/', { fileObjectId: 'abc', fileName: 'f.pdf' });
    expect(isInsideSection(key, 'crm/', 'checked')).toBe(true);
    expect(isInsideSection(key, 'crm/', 'incoming')).toBe(false);
    expect(isInsideSection('locker/checked/abc/f.pdf', 'crm/', 'checked')).toBe(false);
  });

  it('кладёт вложение рядом со своей рассылкой', () => {
    expect(
      campaignObjectKey('crm/', { campaignName: 'Приглашение на конкурс', fileName: 'афиша.png' }),
    ).toBe('crm/campaigns/Приглашение на конкурс/афиша.png');
  });
});
