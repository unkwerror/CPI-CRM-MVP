'use client';

import {
  ArchiveIcon,
  BarChart3Icon,
  CalendarDaysIcon,
  DatabaseIcon,
  DownloadIcon,
  FileCheck2Icon,
  GaugeIcon,
  HandCoinsIcon,
  HandshakeIcon,
  InboxIcon,
  ListChecksIcon,
  LogOutIcon,
  MenuIcon,
  PackageIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
  WalletIcon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';

import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { api, initials } from '@/lib/api';
import type { CurrentUser, DashboardMetrics } from '@/lib/types';
import { cn } from '@/lib/utils';

const demoLoginHint = process.env.NEXT_PUBLIC_DEMO_LOGIN_HINT?.trim();

const WORKSPACE_NAV = [
  { href: '/', label: 'Обзор', icon: BarChart3Icon, permission: 'people.read' },
  { href: '/participants', label: 'Участники', icon: UsersIcon, permission: 'people.read' },
  { href: '/events', label: 'Мероприятия', icon: CalendarDaysIcon, permission: 'people.read' },
  { href: '/review', label: 'Приёмка', icon: FileCheck2Icon, permission: 'artifacts.read' },
  { href: '/tasks', label: 'Задачи', icon: ListChecksIcon, permission: 'tasks.manage' },
  { href: '/calendar', label: 'Календарь', icon: CalendarDaysIcon, permission: 'people.read' },
  { href: '/inbox', label: 'Заявки из бота', icon: InboxIcon, permission: 'people.read' },
];

const SALES_NAV = [
  { href: '/partners', label: 'Партнёры', icon: HandshakeIcon, permission: 'partners.read' },
  { href: '/products', label: 'Продукты', icon: PackageIcon, permission: 'products.read' },
  { href: '/deals', label: 'Продажи', icon: HandCoinsIcon, permission: 'deals.read' },
  { href: '/expenses', label: 'Расходы', icon: WalletIcon, permission: 'expenses.read' },
  { href: '/metrics', label: 'Метрики', icon: GaugeIcon, permission: 'metrics.read' },
  { href: '/audience', label: 'Аудитория', icon: UsersIcon, permission: 'people.read' },
  { href: '/campaigns', label: 'Рассылки', icon: SendIcon, permission: 'campaigns.read' },
];

const SYSTEM_NAV = [
  { href: '/exports', label: 'Выгрузки', icon: DownloadIcon, permission: 'exports.bulk' },
  { href: '/imports', label: 'Импорт', icon: DatabaseIcon, permission: 'imports.run' },
  { href: '/settings', label: 'Настройки', icon: SettingsIcon, permission: 'people.read' },
  { href: '/audit', label: 'Журнал действий', icon: ArchiveIcon, permission: 'audit.read' },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);
  const [overdue, setOverdue] = useState(0);
  const [botInbox, setBotInbox] = useState(0);

  useEffect(() => {
    void api<CurrentUser>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user?.permissions.includes('people.read')) return;
    void api<DashboardMetrics>('/dashboard/participants')
      .then((metrics) => setOverdue(metrics.overdueTasks))
      .catch(() => setOverdue(0));
    void api<{ pendingCount: number }>('/locker/pending?status=PENDING')
      .then((response) => setBotInbox(response.pendingCount))
      .catch(() => setBotInbox(0));
  }, [user, pathname]);

  useEffect(() => setMobileOpen(false), [pathname]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const query = search.trim();
    router.push(query ? `/participants?q=${encodeURIComponent(query)}` : '/participants');
  }

  if (user === null) {
    return (
      <main className="from-sidebar via-sidebar to-background flex min-h-dvh items-center justify-center bg-gradient-to-br p-6">
        <section className="bg-card w-full max-w-md space-y-5 rounded-2xl border p-8 shadow-2xl">
          <span className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-xl text-lg font-semibold">
            Ц
          </span>
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Внутренний сервис ЦПИ
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Единая база участников</h1>
            <p className="text-muted-foreground text-[13px]">
              Участия, проекты, артефакты и рабочая очередь комьюнити-менеджера в одном защищённом
              пространстве.
            </p>
          </div>
          <Button asChild className="w-full" size="lg">
            <a href="/api/auth/login">Войти через ЦПИ ID</a>
          </Button>
          {demoLoginHint && (
            <p className="text-muted-foreground text-center text-xs">{demoLoginHint}</p>
          )}
        </section>
      </main>
    );
  }

  const groups = [
    { caption: 'Рабочее пространство', items: WORKSPACE_NAV },
    { caption: 'Коммерция', items: SALES_NAV },
    { caption: 'Система', items: SYSTEM_NAV },
  ];

  return (
    <TooltipProvider>
      <div className="flex min-h-dvh">
        {mobileOpen && (
          <button
            type="button"
            aria-label="Закрыть меню"
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside
          className={cn(
            'bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0 z-40 flex w-60 flex-col transition-transform duration-200 lg:translate-x-0',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="border-sidebar-border flex h-14 items-center gap-2.5 border-b px-4">
            <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold">
              Ц
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <strong className="text-sidebar-accent-foreground block text-sm">ЦПИ</strong>
              <small className="text-sidebar-foreground/60 block text-[11px]">CRM участников</small>
            </span>
            <button
              type="button"
              aria-label="Закрыть меню"
              className="hover:bg-sidebar-accent rounded-md p-1.5 lg:hidden"
              onClick={() => setMobileOpen(false)}
            >
              <XIcon className="size-4" />
            </button>
          </div>

          <nav
            className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-2.5 py-4"
            aria-label="Основная навигация"
          >
            {groups.map((group) => {
              const items = group.items.filter((item) =>
                user?.permissions.includes(item.permission),
              );
              if (items.length === 0) return null;
              return (
                <div key={group.caption} className="space-y-0.5">
                  <p className="text-sidebar-foreground/45 px-2.5 pb-1.5 text-[10px] font-semibold tracking-widest uppercase">
                    {group.caption}
                  </p>
                  {items.map((item) => {
                    const active = isActive(pathname, item.href);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'focus-visible:ring-sidebar-ring/60 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors focus-visible:ring-[3px] focus-visible:outline-none',
                          active
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                        )}
                      >
                        <Icon className="size-4 shrink-0" strokeWidth={1.9} />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.href === '/tasks' && overdue > 0 && (
                          <span className="bg-destructive text-destructive-foreground rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular">
                            {overdue}
                          </span>
                        )}
                        {item.href === '/inbox' && botInbox > 0 && (
                          <span className="bg-warning text-warning-foreground rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular">
                            {botInbox}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          <div className="border-sidebar-border border-t px-4 py-3">
            <div className="text-sidebar-foreground/60 flex items-start gap-2 text-[11px]">
              <ShieldCheckIcon className="text-success mt-px size-4 shrink-0" />
              <span className="leading-snug">
                <strong className="text-sidebar-foreground/85 block">Защищённый контур</strong>
                Доступ через ЦПИ ID
              </span>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
          <header className="bg-background/85 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-20 flex h-14 items-center gap-2 border-b px-3 backdrop-blur sm:px-5">
            <Button
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              aria-label="Открыть меню"
              onClick={() => setMobileOpen(true)}
            >
              <MenuIcon />
            </Button>

            <form
              className="focus-within:border-ring focus-within:ring-ring/40 bg-card flex h-9 max-w-xl flex-1 items-center gap-2 rounded-md border px-3 transition-shadow focus-within:ring-[3px]"
              onSubmit={submitSearch}
            >
              <SearchIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              <input
                aria-label="Поиск по участникам"
                className="placeholder:text-muted-foreground/70 min-w-0 flex-1 bg-transparent text-sm outline-none"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Найти по имени, телефону, email, проекту…"
                value={search}
              />
              <kbd className="text-muted-foreground bg-muted hidden rounded border px-1.5 py-0.5 text-[10px] font-medium sm:inline-block">
                Enter
              </kbd>
            </form>

            <div className="ml-auto flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" asChild>
                    <Link href="/calendar" aria-label="Календарь">
                      <CalendarDaysIcon />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Календарь и дедлайны</TooltipContent>
              </Tooltip>

              <ThemeToggle />

              <div className="ml-1 flex items-center gap-2 border-l pl-2.5">
                <Avatar className="size-7">
                  <AvatarFallback>{user ? initials(user.name) : '··'}</AvatarFallback>
                </Avatar>
                <span className="hidden leading-tight sm:block">
                  <strong className="block max-w-40 truncate text-[13px] font-medium">
                    {user?.name ?? 'Загрузка…'}
                  </strong>
                  <small className="text-muted-foreground block text-[11px]">
                    {user?.roles[0]?.replaceAll('_', ' ') ?? ''}
                  </small>
                </span>
                <form action="/api/auth/logout" method="post">
                  <Button variant="ghost" size="icon-sm" type="submit" aria-label="Выйти">
                    <LogOutIcon />
                  </Button>
                </form>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-5 sm:px-5 sm:py-6">
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
