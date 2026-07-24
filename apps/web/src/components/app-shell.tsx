'use client';

import {
  Archive,
  BarChart3,
  CalendarDays,
  Database,
  Gauge,
  Handshake,
  HandCoins,
  LogOut,
  Menu,
  Package,
  Search,
  Settings,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';

import { api, initials } from '@/lib/api';
import type { CurrentUser } from '@/lib/types';

const demoLoginHint = process.env.NEXT_PUBLIC_DEMO_LOGIN_HINT?.trim();

const navigation = [
  { href: '/', label: 'Обзор', icon: BarChart3, permission: 'people.read' },
  { href: '/participants', label: 'Участники', icon: Users, permission: 'people.read' },
  { href: '/events', label: 'Мероприятия', icon: CalendarDays, permission: 'people.read' },
  { href: '/partners', label: 'Партнёры', icon: Handshake, permission: 'partners.read' },
  { href: '/products', label: 'Продукты', icon: Package, permission: 'products.read' },
  { href: '/deals', label: 'Продажи', icon: HandCoins, permission: 'deals.read' },
  { href: '/expenses', label: 'Расходы', icon: Wallet, permission: 'expenses.read' },
  { href: '/metrics', label: 'Метрики', icon: Gauge, permission: 'metrics.read' },
  { href: '/imports', label: 'Импорт', icon: Database, permission: 'imports.run' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);

  useEffect(() => {
    void api<CurrentUser>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const query = search.trim();
    router.push(query ? `/participants?q=${encodeURIComponent(query)}` : '/participants');
  }

  if (user === null) {
    return (
      <main className="login-screen">
        <section className="login-card">
          <div className="brand-mark brand-mark--large">Ц</div>
          <p className="eyebrow">Внутренний сервис ЦПИ</p>
          <h1>Единая база участников</h1>
          <p>
            Участия, проекты, артефакты и рабочая очередь комьюнити-менеджера в одном защищённом
            пространстве.
          </p>
          <a className="button button--primary button--wide" href="/api/auth/login">
            Войти через ЦПИ ID
          </a>
          {demoLoginHint && <small>{demoLoginHint}</small>}
        </section>
      </main>
    );
  }

  return (
    <div className="app-frame">
      {mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__brand">
          <span className="brand-mark">Ц</span>
          <span>
            <strong>ЦПИ</strong>
            <small>CRM участников</small>
          </span>
          <button className="icon-button sidebar__close" onClick={() => setMobileOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar__nav" aria-label="Основная навигация">
          <p className="sidebar__caption">Рабочее пространство</p>
          {navigation
            .filter((item) => user?.permissions.includes(item.permission))
            .map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  className={`nav-item ${active ? 'nav-item--active' : ''}`}
                  href={item.href}
                  key={item.href}
                  onClick={() => setMobileOpen(false)}
                >
                  <Icon size={19} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          <p className="sidebar__caption sidebar__caption--spaced">Система</p>
          {user?.permissions.includes('people.read') && (
            <Link className="nav-item" href="/settings">
              <Settings size={19} strokeWidth={1.8} />
              <span>Настройки</span>
            </Link>
          )}
          {user?.permissions.includes('audit.read') && (
            <Link className="nav-item" href="/audit">
              <Archive size={19} strokeWidth={1.8} />
              <span>Журнал действий</span>
            </Link>
          )}
        </nav>
        <div className="sidebar__footer">
          <div className="system-indicator">
            <span className="system-indicator__dot" />
            <span>
              <strong>Защищённый контур</strong>
              <small>Доступ через ЦПИ ID</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)}>
            <Menu size={20} />
          </button>
          <form className="global-search" onSubmit={submitSearch}>
            <Search size={18} />
            <input
              aria-label="Поиск по участникам"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Найти по имени, телефону, email, проекту…"
              value={search}
            />
            <kbd>Enter</kbd>
          </form>
          <div className="topbar__actions">
            <Link className="icon-button" aria-label="Открыть мероприятия" href="/events">
              <CalendarDays size={19} />
              <span className="notification-dot" />
            </Link>
            <div className="user-menu">
              <span className="avatar avatar--small">{user ? initials(user.name) : '··'}</span>
              <span className="user-menu__copy">
                <strong>{user?.name ?? 'Загрузка…'}</strong>
                <small>{user?.roles[0]?.replaceAll('_', ' ') ?? ''}</small>
              </span>
            </div>
            <form action="/api/auth/logout" method="post">
              <button className="logout-button" type="submit">
                <LogOut size={17} />
                <span>Выйти</span>
              </button>
            </form>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
