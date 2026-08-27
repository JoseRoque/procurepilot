type CheckboxFieldProps = {
	id: string;
	name: string;
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
};

export function CheckboxField({
	id,
	name,
	label,
	checked,
	onChange,
}: CheckboxFieldProps) {
	return (
		<label
			htmlFor={id}
			className="flex items-start gap-2.5 rounded-md border border-slate-200 px-3.5 py-3 text-sm text-slate-700 hover:bg-slate-50 has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 has-[:checked]:text-emerald-900"
		>
			<input
				id={id}
				name={name}
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
				className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-emerald-700 focus:ring-emerald-600/40"
			/>
			{label}
		</label>
	);
}
