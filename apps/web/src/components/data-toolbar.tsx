'use client';

import { SearchIcon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export function DataToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-card flex flex-wrap items-end gap-2.5 rounded-xl border px-4 py-3 shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ToolbarSearch({
  value,
  onChange,
  placeholder = 'Поиск…',
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-56 flex-1', className)}>
      <div className="relative">
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          aria-label={label ?? placeholder}
          className="pl-9"
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          value={value}
        />
        {value && (
          <button
            type="button"
            aria-label="Очистить поиск"
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded p-1"
            onClick={() => onChange('')}
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function ToolbarSelect({
  label,
  value,
  onChange,
  options,
  className,
  width = 'w-44',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  width?: string;
}) {
  return (
    <label className={cn('flex flex-col gap-1', width, className)}>
      <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function ToolbarReset({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={disabled}>
      <XIcon />
      Сбросить
    </Button>
  );
}

export function ToolbarSpacer() {
  return <div className="ml-auto" />;
}
