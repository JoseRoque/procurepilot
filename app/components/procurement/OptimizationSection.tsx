import { SectionHeading } from "~/components/procurement/SectionHeading";
import { SectionWrapper } from "~/components/procurement/SectionWrapper";

const FACTORS = [
	{
		factor: "Supplier pricing",
		evaluates: "Contract price, catalog price, tiered volume terms",
		why: "Captures negotiated value",
	},
	{
		factor: "Incentives",
		evaluates: "Rebates, credits, approved promotions, payment terms",
		why: "Reveals net cost",
	},
	{
		factor: "Fulfillment",
		evaluates: "Freight, service fees, lead time, availability",
		why: "Prevents false savings",
	},
	{
		factor: "Requirements",
		evaluates: "Specifications, approved equivalents, quality constraints",
		why: "Keeps purchases fit for purpose",
	},
	{
		factor: "Policy",
		evaluates: "Preferred suppliers, approval thresholds, category rules",
		why: "Keeps spend compliant",
	},
	{
		factor: "Organizational context",
		evaluates: "Cost center, budget, recurring demand",
		why: "Makes recommendations practical",
	},
];

export function OptimizationSection() {
	return (
		<SectionWrapper>
			<SectionHeading title="Total cost is more than unit price." />
			<div className="mt-10 overflow-x-auto rounded-xl border border-slate-200">
				<table className="w-full min-w-[640px] border-collapse text-left text-sm">
					<thead>
						<tr className="border-b border-slate-200 bg-slate-50">
							<th scope="col" className="px-5 py-3.5 font-semibold text-slate-900">
								Factor
							</th>
							<th scope="col" className="px-5 py-3.5 font-semibold text-slate-900">
								What the intelligence evaluates
							</th>
							<th scope="col" className="px-5 py-3.5 font-semibold text-slate-900">
								Why it matters
							</th>
						</tr>
					</thead>
					<tbody>
						{FACTORS.map((row, index) => (
							<tr
								key={row.factor}
								className={index !== FACTORS.length - 1 ? "border-b border-slate-100" : ""}
							>
								<th
									scope="row"
									className="whitespace-nowrap px-5 py-4 font-medium text-slate-900"
								>
									{row.factor}
								</th>
								<td className="px-5 py-4 text-slate-600">{row.evaluates}</td>
								<td className="px-5 py-4 text-slate-600">{row.why}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</SectionWrapper>
	);
}
