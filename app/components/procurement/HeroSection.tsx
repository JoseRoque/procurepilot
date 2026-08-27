import { CtaButton } from "~/components/procurement/CtaButton";
import { DecisionPanel } from "~/components/procurement/DecisionPanel";

function scrollToId(id: string) {
	document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

export function HeroSection() {
	return (
		<section id="product" className="scroll-mt-20 bg-white">
			<div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center lg:px-8 lg:py-28">
				<div>
					<p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
						Purchasing intelligence for distributed spend
					</p>
					<h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
						Make every purchase the lowest compliant cost.
					</h1>
					<p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
						Bring supplier options, negotiated terms, purchasing policy, and
						total cost into one decision layer—so employees can buy faster
						while procurement captures the value it negotiated.
					</p>
					<div className="mt-8 flex flex-col gap-3 sm:flex-row">
						<CtaButton as="a" href="#early-access" size="lg">
							Request early access
						</CtaButton>
						<CtaButton
							as="button"
							variant="secondary"
							size="lg"
							onClick={() => scrollToId("how-it-works")}
						>
							See how it works
						</CtaButton>
					</div>
				</div>

				<div className="flex justify-center lg:justify-end">
					<DecisionPanel
						title="Recommended purchase path"
						context="Facilities supplies · 14 line items · Request #04218"
						rows={[
							{ label: "Approved supplier", value: "Northline Supply" },
							{ label: "Contract subtotal", value: "$1,184.00" },
							{
								label: "Volume rebate",
								value: "-$86.00",
								emphasis: "negative",
							},
							{
								label: "Freight and fees",
								value: "+$24.00",
								emphasis: "positive",
							},
							{
								label: "Net compliant cost",
								value: "$1,122.00",
								emphasis: "total",
							},
							{
								label: "Savings vs. current path",
								value: "$214.00",
								emphasis: "negative",
							},
						]}
						badges={["Policy aligned", "In stock", "Approval ready"]}
						buttonLabel="Review recommendation"
						onButtonClick={() => scrollToId("how-it-works")}
					/>
				</div>
			</div>
		</section>
	);
}
