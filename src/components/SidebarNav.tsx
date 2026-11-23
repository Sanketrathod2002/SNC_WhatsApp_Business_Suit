import { useState } from 'react';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileBarChart2,
  FolderKanban,
  Lock,
  LogOut,
  MessageSquare,
  Send,
  Settings,
  Users,
} from 'lucide-react';
import type { AuthSession, NavSection, UserRole } from '../types';
import { OPERATOR_PROFILE } from '../data/seedData';

interface SidebarNavProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  unreadTotal: number;
  gatewayOnline: boolean;
  adminLocked: boolean;
  session: AuthSession;
  onSignOut: () => void;
}

const NAV_GROUPS: Array<{
  heading: string;
  items: Array<{
    id: NavSection;
    label: string;
    shortLabel: string;
    icon: typeof MessageSquare;
    allowedRoles: UserRole[];
  }>;
}> = [
  {
    heading: 'Workspace',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        shortLabel: 'Home',
        icon: BarChart3,
        allowedRoles: ['ADMIN', 'MANAGER', 'AGENT'],
      },
      {
        id: 'inbox',
        label: 'Inbox',
        shortLabel: 'Inbox',
        icon: MessageSquare,
        allowedRoles: ['ADMIN', 'MANAGER', 'AGENT'],
      },
      {
        id: 'broadcast',
        label: 'Broadcast',
        shortLabel: 'Bulk',
        icon: Send,
        allowedRoles: ['ADMIN', 'MANAGER'],
      },
      {
        id: 'contacts',
        label: 'Contacts',
        shortLabel: 'CRM',
        icon: Users,
        allowedRoles: ['ADMIN', 'MANAGER', 'AGENT'],
      },
    ],
  },
  {
    heading: 'Manage',
    items: [
      {
        id: 'templates',
        label: 'Templates',
        shortLabel: 'Tpls',
        icon: FolderKanban,
        allowedRoles: ['ADMIN', 'MANAGER'],
      },
      {
        id: 'reports',
        label: 'Reports',
        shortLabel: 'Reports',
        icon: FileBarChart2,
        allowedRoles: ['ADMIN', 'MANAGER'],
      },
    ],
  },
  {
    heading: 'Admin',
    items: [
      {
        id: 'workspace',
        label: 'Settings',
        shortLabel: 'Setup',
        icon: Settings,
        allowedRoles: ['ADMIN'],
      },
      {
        id: 'admin_dev',
        label: 'Developer',
        shortLabel: 'Dev',
        icon: Code2,
        allowedRoles: ['ADMIN'],
      },
    ],
  },
];

export function SidebarNav({
  activeSection,
  onSelectSection,
  unreadTotal,
  gatewayOnline,
  adminLocked,
  session,
  onSignOut,
}: SidebarNavProps) {
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((item) => item.allowedRoles.includes(session.role)),
  })).filter((g) => g.items.length > 0);

  const allVisibleItems = visibleGroups.flatMap((g) => g.items);

  const handleNavClick = (section: NavSection) => {
    onSelectSection(section);
    setMobileExpanded(false);
  };

  return (
    <>
      {/* Desktop Left Navigation Sidebar (md+) */}
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#075E54] text-sm font-bold tracking-tight text-white shadow-xs">
            SNC
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-slate-900 whitespace-nowrap">
              SNC WhatsApp
            </p>
            <div className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  gatewayOnline ? 'bg-emerald-500' : 'bg-amber-400'
                }`}
                aria-hidden="true"
              />
              <p className="truncate font-mono text-[10px] text-slate-500 whitespace-nowrap">
                {gatewayOnline ? 'Connected' : 'Standby'}
              </p>
            </div>
          </div>
        </div>

        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {visibleGroups.map((group) => (
            <div key={group.heading}>
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {group.heading}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNavClick(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`group flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                        active
                          ? 'bg-[#075E54] text-white font-semibold shadow-xs'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <Icon
                          className={`h-4 w-4 shrink-0 ${
                            active ? 'text-emerald-200' : 'text-slate-400 group-hover:text-slate-700'
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.id === 'inbox' && unreadTotal > 0 && (
                        <span
                          className={`ml-2 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                            active
                              ? 'bg-white/20 text-white'
                              : 'bg-emerald-50 text-[#075E54]'
                          }`}
                        >
                          {unreadTotal}
                        </span>
                      )}
                      {adminLocked && (item.id === 'workspace' || item.id === 'admin_dev') && (
                        <Lock
                          className={`ml-2 h-3 w-3 shrink-0 ${
                            active ? 'text-emerald-200' : 'text-slate-400'
                          }`}
                          aria-label="Password protected"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3.5">
          <div className="flex items-center gap-2.5">
            <img
              src={OPERATOR_PROFILE.avatarUrl}
              alt={session.name}
              referrerPolicy="no-referrer"
              className="h-8 w-8 shrink-0 rounded-full border border-slate-200 object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-900">{session.name}</p>
              <p className="truncate font-mono text-[10px] text-slate-500">
                {session.role} · {session.mode === 'whatsapp-otp' ? 'OTP Live' : 'Admin PIN'}
              </p>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out of workspace"
              title="Sign Out"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Always-Left Compact Icon Rail + Expandable Left Drawer (< md) — ZERO bottom bar */}
      <aside
        aria-label="Mobile left navigation rail"
        className="flex w-14 shrink-0 flex-col border-r border-slate-200 bg-white md:hidden"
      >
        <div className="flex h-16 flex-col items-center justify-center border-b border-slate-200">
          <button
            type="button"
            onClick={() => setMobileExpanded(true)}
            aria-label="Expand left navigation menu"
            title="Expand menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#075E54] text-xs font-bold text-white"
          >
            SNC
          </button>
        </div>

        <nav
          aria-label="Mobile navigation"
          className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-2 px-1.5"
        >
          {allVisibleItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                title={item.label}
                className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  active
                    ? 'bg-[#075E54] text-white shadow-xs'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.id === 'inbox' && unreadTotal > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-600 px-1 font-mono text-[9px] font-bold text-white">
                    {unreadTotal}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex flex-col items-center gap-1 border-t border-slate-200 py-2">
          <button
            type="button"
            onClick={() => setMobileExpanded(true)}
            aria-label="Open full navigation drawer"
            title="Expand labels"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out of workspace"
            title="Sign Out"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Mobile Left Slide-Over Drawer (opens from left side when expanded) */}
      {mobileExpanded && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="flex w-64 flex-col border-r border-slate-200 bg-white shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#075E54] text-xs font-bold text-white">
                  SNC
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">SNC WhatsApp</p>
                  <p className="font-mono text-[10px] text-slate-500">
                    {gatewayOnline ? 'Connected' : 'Standby'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileExpanded(false)}
                aria-label="Collapse navigation drawer"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
              {visibleGroups.map((group) => (
                <div key={group.heading}>
                  <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {group.heading}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = activeSection === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleNavClick(item.id)}
                          aria-current={active ? 'page' : undefined}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap ${
                            active
                              ? 'bg-[#075E54] text-white font-semibold'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                          }`}
                        >
                          <span className="flex items-center gap-2.5 truncate">
                            <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-emerald-200' : 'text-slate-400'}`} />
                            <span className="truncate">{item.label}</span>
                          </span>
                          {item.id === 'inbox' && unreadTotal > 0 && (
                            <span className="ml-2 font-mono text-[10px] font-bold">{unreadTotal}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            <div className="border-t border-slate-200 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-900">{session.name}</p>
                  <p className="truncate font-mono text-[10px] text-slate-500">{session.role}</p>
                </div>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Exit</span>
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-label="Close navigation menu backdrop"
            onClick={() => setMobileExpanded(false)}
            className="flex-1 bg-slate-950/35 backdrop-blur-[1px]"
          />
        </div>
      )}
    </>
  );
}
