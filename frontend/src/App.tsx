import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Link, RouterProvider } from 'react-router';
import { PageHeader } from '@/components/common';
import { AppLayout } from '@/components/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { LoginPage } from '@/pages/login';
import { RelaysPage } from '@/pages/relays';

// Heavier pages load on demand
const LogsView = lazy(() => import('@/components/logs/logs-view').then((m) => ({ default: m.LogsView })));
const RelayDetailPage = lazy(() => import('@/pages/relay-detail').then((m) => ({ default: m.RelayDetailPage })));
const NewRelayPage = lazy(() => import('@/pages/relay-new').then((m) => ({ default: m.NewRelayPage })));
const DiscordWebhooksPage = lazy(() => import('@/pages/discord-webhooks').then((m) => ({ default: m.DiscordWebhooksPage })));
const TemplateEditorPage = lazy(() => import('@/pages/template-editor').then((m) => ({ default: m.TemplateEditorPage })));

const page = (el: ReactNode) => <Suspense fallback={<Skeleton className="h-64" />}>{el}</Suspense>;

function LogsPage() {
  return (
    <>
      <PageHeader title="Logs" description="Every webhook received, what was sent to Discord, and every delivery attempt." />
      {page(<LogsView />)}
    </>
  );
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/" className="text-muted-foreground mt-2 inline-block text-sm underline">
        Back to relays
      </Link>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <RelaysPage /> },
      { path: '/relays/new', element: page(<NewRelayPage />) },
      { path: '/relays/:id', element: page(<RelayDetailPage />) },
      { path: '/relays/:id/templates/new', element: page(<TemplateEditorPage />) },
      { path: '/relays/:id/templates/:templateId', element: page(<TemplateEditorPage />) },
      { path: '/discord-webhooks', element: page(<DiscordWebhooksPage />) },
      { path: '/logs', element: <LogsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
