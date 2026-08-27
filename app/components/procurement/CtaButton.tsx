import type {
	AnchorHTMLAttributes,
	ButtonHTMLAttributes,
	ReactNode,
} from "react";
import { cn } from "~/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

const BASE =
	"inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60";

const VARIANT_CLASSES: Record<Variant, string> = {
	primary: "bg-slate-900 text-white hover:bg-slate-800",
	secondary:
		"border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
	ghost: "text-slate-900 hover:bg-slate-100",
};

const SIZE_CLASSES: Record<Size, string> = {
	md: "px-4 py-2.5 text-sm",
	lg: "px-6 py-3.5 text-base",
};

type CommonProps = {
	variant?: Variant;
	size?: Size;
	children: ReactNode;
	className?: string;
};

type LinkProps = CommonProps &
	AnchorHTMLAttributes<HTMLAnchorElement> & { as: "a"; href: string };

type ButtonProps = CommonProps &
	ButtonHTMLAttributes<HTMLButtonElement> & { as?: "button" };

export function CtaButton(props: LinkProps | ButtonProps) {
	const { variant = "primary", size = "md", children, className } = props;
	const classes = cn(
		BASE,
		VARIANT_CLASSES[variant],
		SIZE_CLASSES[size],
		className,
	);

	if (props.as === "a") {
		const { as: _as, variant: _v, size: _s, className: _c, ...rest } = props;
		return (
			<a className={classes} {...rest}>
				{children}
			</a>
		);
	}

	const {
		as: _as,
		variant: _v,
		size: _s,
		className: _c,
		type = "button",
		...rest
	} = props;
	return (
		<button type={type} className={classes} {...rest}>
			{children}
		</button>
	);
}
