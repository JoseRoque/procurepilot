import { useState } from "react";
import { CtaButton } from "~/components/procurement/CtaButton";
import { EarlyAccessForm } from "~/components/procurement/form/EarlyAccessForm";
import { SectionHeading } from "~/components/procurement/SectionHeading";
import { SectionWrapper } from "~/components/procurement/SectionWrapper";

function scrollToId(id: string) {
	document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

function SuccessState() {
	return (
		<div className="mx-auto max-w-xl text-center">
			<h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
				You&rsquo;re on the early-access list.
			</h2>
			<p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg">
				We&rsquo;ll be in touch as we shape the first purchasing-intelligence
				pilots. In the meantime, we may send a short research question to
				better understand your purchasing workflow.
			</p>
			<div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
				<CtaButton as="a" href="#top" variant="secondary" size="md">
					Back to top
				</CtaButton>
				<CtaButton
					as="button"
					size="md"
					onClick={() => scrollToId("how-it-works")}
				>
					Explore the workflow
				</CtaButton>
			</div>
		</div>
	);
}

export function EarlyAccessSection() {
	const [succeeded, setSucceeded] = useState(false);

	return (
		<SectionWrapper id="early-access" tone="alt">
			{succeeded ? (
				<SuccessState />
			) : (
				<>
					<SectionHeading
						align="center"
						title="See where purchasing intelligence can reduce leakage."
						description="Join the early-access group for teams shaping a more practical way to control distributed purchasing."
						className="mx-auto"
					/>
					<div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
						<EarlyAccessForm onSuccess={() => setSucceeded(true)} />
					</div>
				</>
			)}
		</SectionWrapper>
	);
}
