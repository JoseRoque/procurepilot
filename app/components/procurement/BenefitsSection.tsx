import { SectionHeading } from "~/components/procurement/SectionHeading";
import { SectionWrapper } from "~/components/procurement/SectionWrapper";

const BENEFITS = [
	{
		title: "Capture more negotiated value",
		copy: "Surface contract pricing, supplier terms, incentives, and approved alternatives when they can still influence the purchase.",
	},
	{
		title: "Reduce spend leakage",
		copy: "Make the approved, cost-effective path easier to select than an off-contract workaround.",
	},
	{
		title: "Reduce decision time",
		copy: "Replace manual comparisons and policy hunting with a decision-ready recommendation.",
	},
	{
		title: "Create defensible purchasing decisions",
		copy: "Show the inputs, constraints, cost calculation, and recommendation rationale behind every guided purchase.",
	},
];

export function BenefitsSection() {
	return (
		<SectionWrapper tone="alt">
			<SectionHeading title="Convert procurement policy into better buying behavior." />
			<div className="mt-12 grid gap-6 sm:grid-cols-2">
				{BENEFITS.map((benefit) => (
					<div
						key={benefit.title}
						className="rounded-xl border border-slate-200 bg-white p-6"
					>
						<h3 className="text-base font-semibold text-slate-900">
							{benefit.title}
						</h3>
						<p className="mt-2 text-sm leading-6 text-slate-600">
							{benefit.copy}
						</p>
					</div>
				))}
			</div>
		</SectionWrapper>
	);
}
