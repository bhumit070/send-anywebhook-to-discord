import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, LogOut, ScrollText, Webhook } from 'lucide-react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { cn } from 'cn';
import { api, ApiError, unwrap } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export function useAppConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => unwrap(api.GET('/api/config')), staleTime: Infinity });
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await unwrap(api.GET('/api/auth/me'));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
}

function NavItem({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors [&_svg]:size-4',
          isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
        )
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}

/** Requires a session (unless auth is disabled) and renders the app chrome. */
export function AppLayout() {
  const config = useAppConfig();
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  if (config.isPending || me.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;

  const logout = async () => {
    await api.POST('/api/auth/logout');
    qc.clear();
    void navigate('/login');
  };

  return (
    <div className="min-h-svh">
      <header className="bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
          <NavLink to="/" className="mr-4 flex items-center gap-2 font-semibold">
            <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-md">
              <Webhook className="size-4" />
            </span>
            <span className="hidden sm:inline">Send Any Webhook to Discord</span>
          </NavLink>
          <nav className="flex items-center gap-1">
            <NavItem to="/" icon={<Webhook />}>
              Relays
            </NavItem>
            <NavItem to="/logs" icon={<ScrollText />}>
              Logs
            </NavItem>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <a href="/docs" target="_blank" rel="noreferrer">
                <BookOpen /> <span className="hidden sm:inline">API docs</span>
              </a>
            </Button>
            {config.data?.authDisabled ? (
              <span className="text-muted-foreground hidden text-xs sm:inline" title="AUTH_DISABLED=true">
                Auth disabled
              </span>
            ) : (
              <>
                <span className="text-muted-foreground hidden text-sm md:inline">{me.data.email}</span>
                <Button variant="ghost" size="sm" onClick={() => void logout()}>
                  <LogOut /> <span className="hidden sm:inline">Log out</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
