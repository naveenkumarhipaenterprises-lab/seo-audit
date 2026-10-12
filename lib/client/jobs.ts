import type { JobView } from "@/lib/audit/jobs";

export type { JobView };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (HTTP ${res.status}).`;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    const e = new Error(msg) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return res.json() as Promise<T>;
}

export async function startAuditJob(body: unknown): Promise<{ jobId: string; job: JobView; duplicate?: boolean }> {
  return json(await fetch("/api/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

export async function getJobView(id: string, signal?: AbortSignal): Promise<JobView> {
  return json(await fetch(`/api/audit/jobs/${id}`, { cache: "no-store", signal }));
}

export async function cancelAuditJob(id: string): Promise<JobView> {
  return json(await fetch(`/api/audit/jobs/${id}/cancel`, { method: "POST" }));
}

export async function listActiveJobs(): Promise<JobView[]> {
  return (await json<{ jobs: JobView[] }>(await fetch("/api/audit/jobs", { cache: "no-store" }))).jobs;
}
