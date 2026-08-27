type DecisionPanelRow = {
	label: string;
	value: string;
	emphasis?: "positive" | "negative" | "total";
};

type DecisionPanelProps = {
	title: string;
	context: string;
	rows: DecisionPanelRow[];
	badges: string[];
	buttonLabel: string;
	onButtonClick?: () => void;
};

function CheckIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			className="h-3.5 w-3.5"
			aria-hidden="true"
		>
			<path
				fillRule="evenodd"
				d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
				clipRule="evenodd"
			/>
		</svg>
	);
}

function rowValueClasses(emphasis: DecisionPanelRow["emphasis"]) {
	if (emphasis === "negative") return "text-emerald-700 font-medium";
	if (emphasis === "positive") return "text-slate-600";
	if (emphasis === "total") return "text-slate-900 font-semibold";
	return "text-slate-700";
}

export function DecisionPanel({
	title,
	context,
	rows,
	badges,
	buttonLabel,
	onButtonClick,
}: DecisionPanelProps) {
	return (
		<div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5 sm:p-6">
			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="text-sm font-semibold text-slate-900">{title}</p>
					<p className="mt-0.5 text-xs text-slate-500">{context}</p>
				</div>
				<span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
					Illustrative
				</span>
			</div>

			<dl className="mt-5 space-y-2.5 border-t border-slate-100 pt-4">
				{rows.map((row) => (
					<div key={row.label} className="flex items-center justify-between gap-4 text-sm">
						<dt className="text-slate-500">{row.label}</dt>
						<dd className={rowValueClasses(row.emphasis)}>{row.value}</dd>
					</div>
				))}
			</dl>

			<div className="mt-5 flex flex-wrap gap-2">
				{badges.map((badge) => (
					<span
						key={badge}
						className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
					>
						<CheckIcon />
						{badge}
					</span>
				))}
			</div>

			<button
				type="button"
				onClick={onButtonClick}
				className="mt-6 w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
			>
				{buttonLabel}
			</button>

			<p className="mt-3 text-center text-[11px] text-slate-400">
				Illustrative purchase recommendation — not real customer data.
			</p>
		</div>
	);
}
