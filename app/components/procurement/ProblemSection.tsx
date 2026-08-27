import { SectionHeading } from "~/components/procurement/SectionHeading";
import { SectionWrapper } from "~/components/procurement/SectionWrapper";

const PROBLEM_CARDS = [
	{
		title: "Total cost stays hidden",
		copy: "Sticker price rarely reflects negotiated terms, freight, rebates, service charges, or the cost of buying outside the right channel.",
	},
	{
		title: "The compliant path is harder",
		copy: "When approved options are difficult to find or compare, requesters choose the fastest familiar route.",
	},
	{
		title: "Savings are discovered too late",
		copy: "Teams often identify variance after a purchase—not at the moment when they could have changed the outcome.",
	},
];

export function ProblemSection() {
	return (
		<SectionWrapper tone="alt">
			<SectionHeading
				title="Your negotiated savings do not matter if employees cannot use them."
				description="Spend becomes fragmented when employees must navigate disconnected catalogs, supplier terms, approval rules, and urgent purchasing needs. The result is slow buying, inconsistent compliance, and avoidable cost leakage."
			/>
			<div className="mt-12 grid gap-6 sm:grid-cols-3">
				{PROBLEM_CARDS.map((card) => (
					<div
						key={card.title}
						className="rounded-xl border border-slate-200 bg-white p-6"
					>
						<h3 className="text-base font-semibold text-slate-900">
							{card.title}
						</h3>
						<p className="mt-2 text-sm leading-6 text-slate-600">
							{card.copy}
						</p>
					</div>
				))}
			</div>
		</SectionWrapper>
	);
}
