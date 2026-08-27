import { BenefitsSection } from "~/components/procurement/BenefitsSection";
import { EarlyAccessSection } from "~/components/procurement/EarlyAccessSection";
import { FaqSection } from "~/components/procurement/FaqSection";
import { HeroSection } from "~/components/procurement/HeroSection";
import { HowItWorksSection } from "~/components/procurement/HowItWorksSection";
import { OptimizationSection } from "~/components/procurement/OptimizationSection";
import { PrivacySection } from "~/components/procurement/PrivacySection";
import { ProblemSection } from "~/components/procurement/ProblemSection";
import { ProcurementFooter } from "~/components/procurement/ProcurementFooter";
import { ProcurementNav } from "~/components/procurement/ProcurementNav";
import { UseCasesSection } from "~/components/procurement/UseCasesSection";
import type { Route } from "./+types/procurement";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Purchasing Intelligence — Lowest compliant cost, every purchase" },
		{
			name: "description",
			content:
				"Purchasing intelligence for distributed spend. Bring supplier options, negotiated terms, purchasing policy, and total cost into one decision layer.",
		},
	];
}

export default function Procurement() {
	return (
		<div id="top" className="bg-white text-slate-900 [color-scheme:light]">
			<ProcurementNav />
			<main>
				<HeroSection />
				<ProblemSection />
				<HowItWorksSection />
				<BenefitsSection />
				<OptimizationSection />
				<PrivacySection />
				<UseCasesSection />
				<FaqSection />
				<EarlyAccessSection />
			</main>
			<ProcurementFooter />
		</div>
	);
}
