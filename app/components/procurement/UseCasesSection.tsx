import { SectionHeading } from "~/components/procurement/SectionHeading";
import { SectionWrapper } from "~/components/procurement/SectionWrapper";

const USE_CASES = [
	"Facilities and office supplies",
	"IT and technology purchases",
	"Marketing and event spend",
	"MRO and operational supplies",
	"Multi-location purchasing",
	"Tail spend and ad-hoc buying",
	"Replenishment and recurring purchases",
	"Supplier and catalog optimization",
];

export function UseCasesSection() {
	return (
		<SectionWrapper tone="alt">
			<SectionHeading title="Built for purchasing that is frequent, fragmented, and hard to govern." />
			<ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{USE_CASES.map((useCase) => (
					<li
						key={useCase}
						className="rounded-lg border border-slate-200 bg-white px-4 py-4 text-sm font-medium text-slate-800"
					>
						{useCase}
					</li>
				))}
			</ul>
		</SectionWrapper>
	);
}
