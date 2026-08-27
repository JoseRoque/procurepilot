import { SectionHeading } from "~/components/procurement/SectionHeading";
import { SectionWrapper } from "~/components/procurement/SectionWrapper";

const FAQS = [
	{
		question: "Does this replace our procurement system?",
		answer:
			"No. It is designed as an intelligence and guidance layer that can complement existing purchasing, supplier, and approval workflows.",
	},
	{
		question: "Does it place orders automatically?",
		answer:
			"The product is designed to guide and prepare purchasing decisions. Organizations retain control over approvals and execution.",
	},
	{
		question: "How does it handle approved suppliers and contracts?",
		answer:
			"Recommendations are designed to account for supplier preference, contract terms, policy constraints, and purchase requirements.",
	},
	{
		question: "What data is required?",
		answer:
			"The intended model is permissioned and incremental. A team can begin with a limited set of supplier, policy, or purchasing signals and expand as value is proven.",
	},
	{
		question: "Who is this for?",
		answer:
			"Procurement, finance, operations, and decentralized teams that want compliant buying to be easier and more cost-effective.",
	},
];

function ChevronIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
			aria-hidden="true"
		>
			<path
				fillRule="evenodd"
				d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
				clipRule="evenodd"
			/>
		</svg>
	);
}

export function FaqSection() {
	return (
		<SectionWrapper id="faq">
			<SectionHeading eyebrow="FAQ" title="Common questions" />
			<div className="mt-10 space-y-3">
				{FAQS.map((faq) => (
					<details
						key={faq.question}
						className="group rounded-lg border border-slate-200 bg-white px-5 py-4 open:bg-slate-50"
					>
						<summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
							{faq.question}
							<ChevronIcon />
						</summary>
						<p className="mt-3 text-sm leading-6 text-slate-600">
							{faq.answer}
						</p>
					</details>
				))}
			</div>
		</SectionWrapper>
	);
}
