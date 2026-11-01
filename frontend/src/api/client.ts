import createClient from 'openapi-fetch';
import type { paths } from './schema';

export const api = createClient<paths>({ baseUrl: '' });

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Returns `data` or throws an ApiError with the server's message. */
export async function unwrap<T>(request: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await request;
  if (!response.ok) {
    const message = (error as { message?: string } | undefined)?.message ?? `${response.status} ${response.statusText}`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
