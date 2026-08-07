import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap w-fit shrink-0 [&>svg]:size-3 [&>svg]:pointer-events-none transition-colors overflow-hidden [a&]:hover:opacity-90 focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
        success: 'border-transparent bg-success text-success-foreground',
        warning: 'border-transparent bg-warning text-warning-foreground',
        info: 'border-transparent bg-info text-info-foreground',
        /* Приглушённые варианты для плотных таблиц, где насыщенная заливка шумит. */
        'soft-success': 'border-success/25 bg-success/12 text-success',
        'soft-warning': 'border-warning/30 bg-warning/15 text-warning',
        'soft-destructive': 'border-destructive/25 bg-destructive/12 text-destructive',
        'soft-info': 'border-info/25 bg-info/12 text-info',
        'soft-primary': 'border-primary/25 bg-primary/12 text-primary',
        'soft-muted': 'border-border bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'span';
  return (
    <Component
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
