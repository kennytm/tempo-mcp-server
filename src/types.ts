import { z } from 'zod';

export const dateSchema = () =>
  z.iso.date({ error: 'Date must be a valid date in YYYY-MM-DD format' });

export const envSchema = z.object({
  TEMPO_API_TOKEN: z.string().trim().min(1, 'TEMPO_API_TOKEN is required'),
});

export type Env = z.infer<typeof envSchema>;

export const retrieveWorklogsSchema = z.object({
  startDate: dateSchema(),
  endDate: dateSchema(),
});

export interface TempoWorklog {
  tempoWorklogId: string | number;
  issue?: { id?: string | number };
  timeSpentSeconds: number;
  startDate: string;
  description?: string;
  author?: { accountId: string };
  startTime?: string;
  attributes?: {
    values: { key: string; value: string }[];
  };
}

export interface TempoWorklogPage {
  results?: TempoWorklog[];
  metadata?: {
    limit?: number;
    offset?: number;
    next?: string;
  };
}

export interface ToolResponse {
  content: { type: 'text'; text: string }[];
  metadata?: Record<string, unknown>;
  isError?: boolean;
}

export interface Ctx {
  tempoApi: { baseUrl: string; token: string };
}

export interface Config extends Ctx {
  server: { name: string; version: string };
}
