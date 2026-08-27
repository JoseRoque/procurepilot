import type { ReactNode } from "react";

type BadgeTone = "neutral" | "success" | "warning" | "info";

const TONE_CLASSES: Record<BadgeTone, string> = {
	neutral: "bg-slate-100 text-slate-700",
	success: "bg-emerald-50 text-emerald-700",
	warning: "bg-amber-50 text-amber-800",
	info: "bg-slate-800 text-white",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
	return (
		<span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]}`}>
			{children}
		</span>
	);
}
