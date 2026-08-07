'use client';

import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import type { CurrentUser } from '@/lib/types';

export function useCurrentUser(): {
  user: CurrentUser | null | undefined;
  permissions: string[];
  can: (permission: string) => boolean;
} {
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);

  useEffect(() => {
    void api<CurrentUser>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const permissions = user?.permissions ?? [];
  return { user, permissions, can: (permission) => permissions.includes(permission) };
}
