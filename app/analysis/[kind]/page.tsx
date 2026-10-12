import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
const KINDS: Record<string, { tab: string; title: string }> = {
  seo: { tab: "seo", title: "SEO Analysis" },
  aeo: { tab: "aeo", title: "AEO Analysis" },
  geo: { tab: "geo", title: "GEO Analysis" },
};

export default async function Analysis({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const k = KINDS[kind];
  if (!k) notFound();
  const latest = (await getStore().list(1))[0];
  if (latest) redirect(`/audits/${latest.id}?tab=${k.tab}`);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{k.title}</h1>
      <Card><CardContent className="py-8 text-center text-sm text-slate-500">No audits yet. <Link href="/audit/new" className="font-medium text-brand-700 hover:underline">Run an audit</Link> to see its {k.title}.</CardContent></Card>
    </div>
  );
}
