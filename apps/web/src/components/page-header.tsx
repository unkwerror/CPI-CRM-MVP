import { ChevronLeftIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  backHref,
  backLabel,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {backHref && (
        <Link
          href={backHref}
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-[13px] transition-colors"
        >
          <ChevronLeftIcon className="size-4" />
          {backLabel ?? 'Назад'}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          {eyebrow && (
            <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              {eyebrow}
            </div>
          )}
          <h1 className="text-foreground text-xl leading-tight font-semibold tracking-tight text-balance sm:text-2xl">
            {title}
          </h1>
          {description && (
            <div className="text-muted-foreground max-w-3xl text-[13px]">{description}</div>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function PageStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-5', className)}>{children}</div>;
}
