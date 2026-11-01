import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Webhook } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { api, errorMessage, unwrap } from '@/api/client';
import { useAppConfig, useMe } from '@/components/layout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const config = useAppConfig();
  const me = useMe();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/';

  const submit = useMutation({
    mutationFn: () =>
      unwrap(
        mode === 'login'
          ? api.POST('/api/auth/login', { body: { email, password } })
          : api.POST('/api/auth/register', { body: { email, password } }),
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      void navigate(next, { replace: true });
    },
  });

  if (config.data?.authDisabled || me.data) return <Navigate to={next} replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };
  const canRegister = config.data?.registrationEnabled ?? false;

  return (
    <main className="grid min-h-svh place-items-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="bg-primary text-primary-foreground grid size-11 place-items-center rounded-xl">
            <Webhook className="size-6" />
          </span>
          <h1 className="text-xl font-semibold">Send Any Webhook to Discord</h1>
          <p className="text-muted-foreground text-sm">Relay any webhook to Discord</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{mode === 'login' ? 'Log in' : 'Create an account'}</CardTitle>
            <CardDescription>
              {mode === 'login' ? 'Welcome back.' : 'Passwords need at least 8 characters.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={mode === 'register' ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {submit.isError && (
                <Alert variant="destructive">
                  <AlertDescription>{errorMessage(submit.error)}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={submit.isPending}>
                {mode === 'login' ? 'Log in' : 'Create account'}
              </Button>
            </form>
            {(canRegister || mode === 'register') && (
              <p className="text-muted-foreground mt-4 text-center text-sm">
                {mode === 'login' ? 'No account yet?' : 'Already have an account?'}{' '}
                <button
                  type="button"
                  className="text-foreground font-medium underline-offset-4 hover:underline"
                  onClick={() => {
                    submit.reset();
                    setMode(mode === 'login' ? 'register' : 'login');
                  }}
                >
                  {mode === 'login' ? 'Sign up' : 'Log in'}
                </button>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
