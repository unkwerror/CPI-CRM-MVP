import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { events } from '../src/schema.js';

const dialect = new PgDialect();

describe('event database invariants', () => {
  const table = getTableConfig(events);

  it('allows only the supported live and legacy statuses', () => {
    const constraint = table.checks.find((candidate) => candidate.name === 'events_status_check');

    expect(constraint).toBeDefined();
    expect(dialect.sqlToQuery(constraint!.value).sql).toBe(
      `"events"."status" in ('UNKNOWN', 'PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED')`,
    );
  });

  it('keeps active normalized event names unique inside an organization', () => {
    const index = table.indexes.find(
      (candidate) => candidate.config.name === 'events_organization_normalized_name_uidx',
    );

    expect(index).toBeDefined();
    expect(index!.config.unique).toBe(true);
    expect(index!.config.columns.map((column) => ('name' in column ? column.name : null))).toEqual([
      'organization_id',
      'normalized_name',
    ]);
    expect(index!.config.where).toBeDefined();
    expect(dialect.sqlToQuery(index!.config.where!).sql).toBe('"events"."archived_at" is null');
  });
});
