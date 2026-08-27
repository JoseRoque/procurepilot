import { SectionHeading } from "~/components/procurement/SectionHeading";
import { SectionWrapper } from "~/components/procurement/SectionWrapper";

const PRINCIPLES = [
	{
		title: "Keep sensitive data controlled",
		copy: "Do not centralize credentials, raw session data, or sensitive purchasing context by default.",
	},
	{
		title: "Separate private context from shared learning",
		copy: "Use permissioned and aggregated patterns to improve recommendations without turning private purchase history into a public data asset.",
	},
	{
		title: "Keep people in control",
		copy: "Support approval gates, exception handling, and auditable review before material purchasing actions.",
	},
];

export function PrivacySection() {
	return (
		<SectionWrapper id="privacy" tone="ink">
			<SectionHeading
				tone="inverted"
				title="Useful intelligence without unnecessary data exposure."
				description="Designed for a local-first, permissioned model: sensitive organizational and user context can remain within approved environments, while only authorized, redacted, or aggregated signals contribute to shared optimization."
			/>
			<div className="mt-12 grid gap-6 sm:grid-cols-3">
				{PRINCIPLES.map((principle) => (
					<div
						key={principle.title}
						className="rounded-xl border border-slate-700 bg-slate-800/60 p-6"
					>
						<h3 className="text-base font-semibold text-white">
							{principle.title}
						</h3>
						<p className="mt-2 text-sm leading-6 text-slate-300">
							{principle.copy}
						</p>
					</div>
				))}
			</div>
		</SectionWrapper>
	);
}
