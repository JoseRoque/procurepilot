import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

type SectionHeadingProps = {
	eyebrow?: string;
	title: string;
	description?: ReactNode;
	align?: "left" | "center";
	tone?: "default" | "inverted";
	as?: "h1" | "h2";
	className?: string;
};

export function SectionHeading({
	eyebrow,
	title,
	description,
	align = "left",
	tone = "default",
	as = "h2",
	className,
}: SectionHeadingProps) {
	const Heading = as;
	const isCenter = align === "center";
	const isInverted = tone === "inverted";

	return (
		<div
			className={cn(
				"max-w-3xl",
				isCenter && "mx-auto text-center",
				className,
			)}
		>
			{eyebrow ? (
				<p
					className={cn(
						"text-sm font-semibold uppercase tracking-wide",
						isInverted ? "text-emerald-300" : "text-emerald-700",
					)}
				>
					{eyebrow}
				</p>
			) : null}
			<Heading
				className={cn(
					"mt-3 text-3xl font-semibold tracking-tight sm:text-4xl",
					isInverted ? "text-white" : "text-slate-900",
				)}
			>
				{title}
			</Heading>
			{description ? (
				<p
					className={cn(
						"mt-4 text-base leading-7 sm:text-lg",
						isInverted ? "text-slate-300" : "text-slate-600",
					)}
				>
					{description}
				</p>
			) : null}
		</div>
	);
}
