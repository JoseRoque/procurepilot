import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

type FormFieldProps = {
	id: string;
	label: string;
	required?: boolean;
	error?: string;
	description?: string;
	children: ReactNode;
	className?: string;
};

export const FIELD_INPUT_CLASSES =
	"w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-500/20";

export function FormField({
	id,
	label,
	required,
	error,
	description,
	children,
	className,
}: FormFieldProps) {
	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<label htmlFor={id} className="text-sm font-medium text-slate-900">
				{label}
				{required ? (
					<span aria-hidden="true" className="text-emerald-700">
						{" "}
						*
					</span>
				) : null}
			</label>
			{children}
			{description && !error ? (
				<p className="text-xs text-slate-500">{description}</p>
			) : null}
			{error ? (
				<p id={`${id}-error`} className="text-xs font-medium text-red-600" role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}
