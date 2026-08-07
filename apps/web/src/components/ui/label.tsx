'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'text-muted-foreground flex items-center gap-2 text-xs leading-none font-medium tracking-wide uppercase select-none',
        'group-data-[disabled=true]:opacity-50 peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
