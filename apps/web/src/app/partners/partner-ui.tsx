'use client';

import type { ReactNode } from 'react';

import type { badgeVariants } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import type { AgreementStatus, PartnerStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

type BadgeVariant = NonNullable<Parameters<typeof badgeVariants>[0]>['variant'];

export const PARTNER_STATUS_VARIANTS: Record<PartnerStatus, BadgeVariant> = {
  PROSPECT: 'soft-muted',
  DEVELOPING: 'soft-info',
  ACTIVE: 'soft-success',
  PAUSED: 'soft-warning',
  CLOSED: 'soft-destructive',
};

export const AGREEMENT_STATUS_VARIANTS: Record<AgreementStatus, BadgeVariant> = {
  DRAFT: 'soft-muted',
  NEGOTIATION: 'soft-warning',
  ACTIVE: 'soft-success',
  COMPLETED: 'soft-info',
  TERMINATED: 'soft-destructive',
};

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function Field({
  label,
  htmlFor,
  full = false,
  children,
}: {
  label: string;
  htmlFor: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', full && 'sm:col-span-2')}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
