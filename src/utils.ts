import axios from 'axios';

export function formatError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { message?: string; errors?: { message?: string }[] }
      | undefined;
    const tempoErrors = Array.isArray(data?.errors)
      ? data.errors
          .map((e) => e.message)
          .filter(Boolean)
          .join('; ')
      : '';
    return data?.message || tempoErrors || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
