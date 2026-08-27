import type { ReactNode } from "react";

export function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="rounded-xl border border-slate-200 bg-white p-4">
			<h2 className="text-sm font-semibold text-slate-900">{title}</h2>
			<div className="mt-3">{children}</div>
		</section>
	);
}
