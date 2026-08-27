import { SectionHeading } from "~/components/procurement/SectionHeading";
import { SectionWrapper } from "~/components/procurement/SectionWrapper";

const STEPS = [
	{
		title: "Observe",
		copy: "Bring together approved supplier options, request details, catalog data, and permitted purchasing signals.",
	},
	{
		title: "Normalize",
		copy: "Match comparable items, normalize units and terms, and calculate the total cost of each viable path.",
	},
	{
		title: "Optimize",
		copy: "Rank options against cost, policy, availability, specification, delivery, and organizational constraints.",
	},
	{
		title: "Guide",
		copy: "Present an explainable recommendation with approval-ready context and a clear audit trail.",
	},
];

export function HowItWorksSection() {
	return (
		<SectionWrapper id="how-it-works">
			<SectionHeading
				eyebrow="How it works"
				title="Guide the decision before spend happens."
			/>
			<div className="relative mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
				<div
					className="absolute top-5 right-0 left-0 hidden h-px bg-slate-200 lg:block"
					aria-hidden="true"
				/>
				{STEPS.map((step, index) => (
					<div key={step.title} className="relative">
						<div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
							{index + 1}
						</div>
						<h3 className="mt-4 text-base font-semibold text-slate-900">
							{step.title}
						</h3>
						<p className="mt-2 text-sm leading-6 text-slate-600">
							{step.copy}
						</p>
					</div>
				))}
			</div>
		</SectionWrapper>
	);
}
