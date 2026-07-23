import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';

import './globals.css';

export const metadata: Metadata = {
  title: 'ЦПИ — CRM участников',
  description: 'Единая база участников Центра проектных инициатив',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
