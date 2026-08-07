'use client';

import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const OPTIONS = [
  { value: 'light', label: 'Светлая', Icon: SunIcon },
  { value: 'dark', label: 'Тёмная', Icon: MoonIcon },
  { value: 'system', label: 'Как в системе', Icon: MonitorIcon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // До гидратации тема неизвестна, поэтому иконка рисуется нейтральной.
  const ActiveIcon = !mounted ? MonitorIcon : resolvedTheme === 'dark' ? MoonIcon : SunIcon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring/60 inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
        aria-label="Оформление"
      >
        <ActiveIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            className={theme === value ? 'text-primary font-medium' : undefined}
          >
            <Icon />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
