'use client';

import { KanbanIcon, TableIcon } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type RegistryView = 'board' | 'table';

export function ViewSwitch({
  value,
  onChange,
}: {
  value: RegistryView;
  onChange: (view: RegistryView) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as RegistryView)}>
      <TabsList aria-label="Вид представления">
        <TabsTrigger value="board">
          <KanbanIcon />
          Доска
        </TabsTrigger>
        <TabsTrigger value="table">
          <TableIcon />
          Таблица
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
