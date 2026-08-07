import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

function TableWrapper({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="table-container"
      className={cn('scrollbar-thin relative w-full overflow-x-auto', className)}
      {...props}
    />
  );
}

function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <table
      data-slot="table"
      className={cn('w-full caption-bottom border-collapse text-sm', className)}
      {...props}
    />
  );
}

function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('bg-muted/60 [&_tr]:border-b', className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('bg-muted/40 border-t font-medium', className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'hover:bg-muted/40 data-[state=selected]:bg-accent border-b transition-colors',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'text-muted-foreground h-9 px-3 text-left align-middle text-xs font-semibold tracking-wide whitespace-nowrap uppercase',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td data-slot="table-cell" className={cn('px-3 py-2.5 align-middle', className)} {...props} />
  );
}

function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('text-muted-foreground mt-3 text-[13px]', className)}
      {...props}
    />
  );
}

export {
  Table,
  TableWrapper,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
};
