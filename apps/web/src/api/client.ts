import {
  HealthSchema,
  ProjectSchema,
  ProjectSummarySchema,
  type Health,
  type Project,
  type ProjectSummary,
  type SaveProjectRequest,
} from '@buildview/shared';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError('Cannot reach the BuildView API. Is the server running?', 0, 'network');
  }
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const body = (json ?? {}) as { message?: string; error?: string };
    throw new ApiError(body.message ?? `Request failed (${res.status})`, res.status, body.error);
  }
  return schema.parse(json);
}

export const api = {
  health: (): Promise<Health> => request('/health', HealthSchema),
  list: (): Promise<ProjectSummary[]> => request('/projects', z.array(ProjectSummarySchema)),
  get: (id: string): Promise<Project> => request(`/projects/${id}`, ProjectSchema),
  createSample: (name?: string): Promise<Project> =>
    request('/projects', ProjectSchema, { method: 'POST', body: JSON.stringify(name ? { name } : {}) }),
  save: (id: string, body: SaveProjectRequest): Promise<Project> =>
    request(`/projects/${id}`, ProjectSchema, { method: 'PUT', body: JSON.stringify(body) }),
  duplicate: (id: string, name?: string): Promise<Project> =>
    request(`/projects/${id}/duplicate`, ProjectSchema, { method: 'POST', body: JSON.stringify(name ? { name } : {}) }),
};
