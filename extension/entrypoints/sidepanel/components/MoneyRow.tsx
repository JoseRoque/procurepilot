import { formatCents } from "@/lib/money";
import type { MoneyFact } from "@/lib/types";

export function MoneyRow({ label, fact }: { label: string; fact?: MoneyFact }) {
	return (
		<div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-b-0">
			<span className="text-slate-600">{label}</span>
			{fact ? (
				<span className="flex items-baseline gap-2">
					<span className="font-medium text-slate-900">{formatCents(fact.cents)}</span>
					<span className="text-[11px] text-slate-400">Visible on page</span>
				</span>
			) : (
				<span className="text-xs text-slate-400">Not detected</span>
			)}
		</div>
	);
}

export function EstimatedRow({ label, cents }: { label: string; cents?: number }) {
	return (
		<div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-b-0">
			<span className="text-slate-600">{label}</span>
			{cents !== undefined ? (
				<span className="flex items-baseline gap-2">
					<span className="font-medium text-slate-900">{formatCents(cents)}</span>
					<span className="text-[11px] text-slate-400">Estimated from visible details</span>
				</span>
			) : (
				<span className="text-xs text-slate-400">Not detected</span>
			)}
		</div>
	);
}
