'use client';

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { type ReactNode, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';

export interface KanbanColumn {
  id: string;
  title: string;
  /** Подпись под заголовком: сумма, срок, пояснение. */
  hint?: ReactNode;
  accentClassName?: string;
}

interface KanbanBoardProps<T> {
  columns: KanbanColumn[];
  items: T[];
  getId: (item: T) => string;
  getColumnId: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  onMove?: (itemId: string, toColumnId: string) => void | Promise<void>;
  /** Запрет перетаскивания в конкретную колонку (например, «Выиграна» требует диалога). */
  canDrop?: (item: T, toColumnId: string) => boolean;
  emptyColumnText?: string;
  className?: string;
}

function KanbanCard({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'bg-card rounded-lg border p-3 shadow-xs transition-shadow',
        !disabled && 'cursor-grab active:cursor-grabbing hover:shadow-md',
        isDragging && 'opacity-40',
      )}
    >
      {children}
    </div>
  );
}

function KanbanColumnShell({
  column,
  count,
  children,
}: {
  column: KanbanColumn;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'bg-muted/45 flex min-w-64 flex-1 flex-col rounded-xl border transition-colors',
        isOver && 'border-primary bg-primary/5',
      )}
    >
      <header className="flex items-start justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('size-2 shrink-0 rounded-full bg-current', column.accentClassName)} />
            <h3 className="truncate text-[13px] font-semibold">{column.title}</h3>
            <span className="text-muted-foreground text-xs tabular">{count}</span>
          </div>
          {column.hint && (
            <p className="text-muted-foreground mt-0.5 pl-4 text-[11px]">{column.hint}</p>
          )}
        </div>
      </header>
      <div className="scrollbar-thin flex max-h-[calc(100dvh-16rem)] flex-col gap-2 overflow-y-auto px-2 pb-2">
        {children}
      </div>
    </section>
  );
}

export function KanbanBoard<T>({
  columns,
  items,
  getId,
  getColumnId,
  renderCard,
  onMove,
  canDrop,
  emptyColumnText = 'Пусто',
  className,
}: KanbanBoardProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Порог в 6px оставляет обычные клики по кнопкам внутри карточки рабочими.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const grouped = useMemo(() => {
    const map = new Map<string, T[]>(columns.map((column) => [column.id, []]));
    for (const item of items) {
      const bucket = map.get(getColumnId(item));
      if (bucket) bucket.push(item);
    }
    return map;
  }, [columns, items, getColumnId]);

  const activeItem = activeId ? items.find((item) => getId(item) === activeId) : undefined;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || !onMove) return;

    const itemId = String(active.id);
    const toColumnId = String(over.id);
    const item = items.find((candidate) => getId(candidate) === itemId);
    if (!item || getColumnId(item) === toColumnId) return;
    if (canDrop && !canDrop(item, toColumnId)) return;

    void onMove(itemId, toColumnId);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className={cn('scrollbar-thin flex items-start gap-3 overflow-x-auto pb-2', className)}>
        {columns.map((column) => {
          const columnItems = grouped.get(column.id) ?? [];
          return (
            <KanbanColumnShell key={column.id} column={column} count={columnItems.length}>
              {columnItems.length === 0 ? (
                <p className="text-muted-foreground/70 px-1 py-6 text-center text-xs">
                  {emptyColumnText}
                </p>
              ) : (
                columnItems.map((item) => (
                  <KanbanCard key={getId(item)} id={getId(item)} disabled={!onMove}>
                    {renderCard(item)}
                  </KanbanCard>
                ))
              )}
            </KanbanColumnShell>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeItem && (
          <div className="bg-card rotate-1 rounded-lg border p-3 shadow-2xl">
            {renderCard(activeItem)}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
