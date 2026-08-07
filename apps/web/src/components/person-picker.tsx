'use client';

import { SearchIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { PersonSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface PersonOption {
  id: string;
  canonicalFullName: string;
}

/**
 * Поиск участника по ФИО с подсказками. `options` позволяет искать в заранее
 * загруженном списке (например, только среди участников мероприятия) вместо
 * обращения к `/people`.
 */
export function PersonPicker({
  value,
  onChange,
  options,
  placeholder = 'Начните вводить ФИО…',
  disabled,
  className,
}: {
  value: PersonOption | null;
  onChange: (person: PersonOption | null) => void;
  options?: PersonOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<PersonSummary[]>([]);

  useEffect(() => {
    if (options) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setRemote([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api<{ items: PersonSummary[] }>(`/people?q=${encodeURIComponent(trimmed)}`)
        .then((response) => setRemote(response.items.slice(0, 8)))
        .catch(() => setRemote([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [options, query]);

  if (value) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <span className="bg-muted flex-1 truncate rounded-md border px-3 py-2 text-[13px] font-medium">
          {value.canonicalFullName}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Убрать участника"
          disabled={disabled}
          onClick={() => {
            onChange(null);
            setQuery('');
          }}
        >
          <XIcon />
        </Button>
      </div>
    );
  }

  const suggestions: PersonOption[] = options
    ? query.trim().length === 0
      ? options.slice(0, 8)
      : options
          .filter((person) =>
            person.canonicalFullName.toLowerCase().includes(query.trim().toLowerCase()),
          )
          .slice(0, 8)
    : remote;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="relative">
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          className="pl-9"
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          value={query}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((person) => (
            <Button
              key={person.id}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                onChange(person);
                setQuery('');
              }}
            >
              {person.canonicalFullName}
            </Button>
          ))}
        </div>
      )}
      {!options && query.trim().length >= 2 && suggestions.length === 0 && (
        <p className="text-muted-foreground text-xs">Ничего не нашлось</p>
      )}
    </div>
  );
}
