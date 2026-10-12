"use client";
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";
import { scoreTone } from "@/lib/utils";

export function ScoreRing({ label, score, size = 120, sub }: { label: string; score: number | null; size?: number; sub?: string }) {
  const tone = scoreTone(score);
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart innerRadius="78%" outerRadius="100%" data={[{ value: score ?? 0 }]} startAngle={90} endAngle={-270} barSize={10}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
            <RadialBar dataKey="value" background={{ fill: "#f1f5f9" }} cornerRadius={8} fill={tone.ring} isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {score === null ? <span className="px-2 text-xs font-medium text-slate-400">Not tested</span> : <span className={`text-2xl font-bold ${tone.text}`}>{score}</span>}
        </div>
      </div>
      <p className="mt-2 text-sm font-medium text-slate-800">{label}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
