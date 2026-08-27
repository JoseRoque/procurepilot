import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

type SectionWrapperProps = {
	id?: string;
	children: ReactNode;
	className?: string;
	tone?: "default" | "alt" | "ink";
};

const TONE_CLASSES: Record<NonNullable<SectionWrapperProps["tone"]>, string> = {
	default: "bg-white",
	alt: "bg-slate-50",
	ink: "bg-slate-900 text-white",
};

export function SectionWrapper({
	id,
	children,
	className,
	tone = "default",
}: SectionWrapperProps) {
	return (
		<section id={id} className={cn("scroll-mt-20", TONE_CLASSES[tone])}>
			<div className={cn("mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8", className)}>
				{children}
			</div>
		</section>
	);
}
