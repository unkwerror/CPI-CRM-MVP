import { InboxIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function EmptyState({
  title,
  text,
  icon: Icon = InboxIcon,
  action,
  className,
}: {
  title: string;
  text?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="text-foreground text-sm font-medium">{title}</p>
        {text && <p className="text-muted-foreground mx-auto max-w-sm text-[13px]">{text}</p>}
      </div>
      {action}
    </div>
  );
}
