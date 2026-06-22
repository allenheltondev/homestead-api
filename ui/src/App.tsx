import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/useAuth';
import Logo from './components/Logo';
import UserMenu from './components/UserMenu';
import { useTheme } from './theme/useTheme';

const baseLink = 'rounded-md text-sm font-medium transition-colors';

// The nav links render in two places — the horizontal desktop bar and the
// collapsed mobile sheet — so the active/idle styling is factored out and
// the layout (padding/block) is passed in per surface.
const linkClass =
  (extra: string) =>
  ({ isActive }: { isActive: boolean }): string =>
    isActive
      ? `${baseLink} ${extra} bg-primary-100 text-primary-700`
      : `${baseLink} ${extra} text-muted-foreground hover:bg-muted hover:text-foreground`;

const desktopBarLink = linkClass('px-3 py-1.5');
const desktopMenuLink = linkClass('block px-3 py-2');
const mobileLink = linkClass('block px-3 py-2.5');

interface NavLeaf {
  to: string;
  label: string;
}

interface NavGroup {
  label: string;
  items: NavLeaf[];
}

// The 13 routes are grouped into a handful of sections so the bar stays
// scannable. Every route remains reachable — desktop renders each group as a
// dropdown menu, mobile renders them as labelled sections in the sheet.
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Animals',
    items: [
      { to: '/animals', label: 'Animals' },
      { to: '/pastures', label: 'Pastures' },
      { to: '/hatchery', label: 'Hatchery' },
      { to: '/health', label: 'Health' },
    ],
  },
  {
    label: 'Production',
    items: [
      { to: '/eggs', label: 'Eggs' },
      { to: '/milk', label: 'Milk' },
      { to: '/feed', label: 'Feed' },
      { to: '/care', label: 'Care' },
    ],
  },
  {
    label: 'Garden',
    items: [
      { to: '/garden', label: 'Garden' },
      { to: '/beds', label: 'Beds & crops' },
      { to: '/good-roots', label: 'Good Roots' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/', label: 'Dashboard' },
      { to: '/pnl', label: 'P&L' },
    ],
  },
  {
    label: 'Ask',
    items: [{ to: '/copilot', label: 'Copilot' }],
  },
];

// A single desktop group: a trigger button that opens a dropdown of its
// routes. Mirrors the UserMenu dropdown — click-outside + Escape close it, and
// the trigger reflects the open state and whether the active route lives
// inside the group.
function DesktopNavGroup({ group }: { group: NavGroup }): ReactElement {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const groupActive = group.items.some((item) =>
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to),
  );

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // A single-route group needs no dropdown — render it as a plain link.
  if (group.items.length === 1) {
    return (
      <NavLink to={group.items[0].to} end={group.items[0].to === '/'} className={desktopBarLink}>
        {group.label}
      </NavLink>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${baseLink} px-3 py-1.5 inline-flex items-center gap-1 ${
          groupActive
            ? 'bg-primary-100 text-primary-700'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        {group.label}
        <span aria-hidden className="text-[0.6rem] leading-none">
          ▾
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 mt-2 w-48 card overflow-hidden z-50 p-1">
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              role="menuitem"
              end={item.to === '/'}
              className={desktopMenuLink}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App(): ReactElement {
  const { user, isAuthenticated, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSignOut = (): void => {
    void signOut().then(() => navigate('/signin', { replace: true }));
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-surface border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-4 sm:gap-6">
          <NavLink
            to="/"
            end
            className="flex items-center gap-2 text-base font-semibold text-foreground shrink-0"
            onClick={() => setMenuOpen(false)}
          >
            <Logo className="h-6 w-auto" />
            Homestead
          </NavLink>

          {/* Desktop nav — grouped dropdowns, hidden on small screens in
              favour of the sheet. */}
          <nav className="hidden md:flex items-center gap-1 flex-1" aria-label="Primary">
            {NAV_GROUPS.map((group) => (
              <DesktopNavGroup key={group.label} group={group} />
            ))}
          </nav>

          {/* Pushes the controls to the right on mobile, where the nav is hidden. */}
          <div className="flex-1 md:hidden" />

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 shrink-0"
          >
            <span aria-hidden>{theme === 'dark' ? '☀' : '☾'}</span>
          </button>
          {isAuthenticated && user && (
            <UserMenu user={user} onSignOut={handleSignOut} />
          )}

          {/* Hamburger — toggles the mobile nav sheet. */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            className="md:hidden flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 shrink-0"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {menuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>

        {/* Mobile nav sheet — collapses the primary links behind the hamburger,
            grouped into the same labelled sections as the desktop dropdowns. */}
        {menuOpen && (
          <nav
            id="mobile-nav"
            className="md:hidden border-t border-border px-2 py-2 flex flex-col gap-3"
            aria-label="Primary"
          >
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="flex flex-col gap-1">
                <span className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </span>
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={mobileLink}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        )}
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </main>
    </div>
  );
}
