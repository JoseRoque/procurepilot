type CheckboxGroupProps = {
	legend: string;
	description?: string;
	name: string;
	options: readonly string[];
	values: string[];
	onChange: (values: string[]) => void;
};

export function CheckboxGroup({
	legend,
	description,
	name,
	options,
	values,
	onChange,
}: CheckboxGroupProps) {
	function toggle(option: string) {
		if (values.includes(option)) {
			onChange(values.filter((value) => value !== option));
		} else {
			onChange([...values, option]);
		}
	}

	return (
		<fieldset className="flex flex-col gap-2">
			<legend className="text-sm font-medium text-slate-900">{legend}</legend>
			{description ? (
				<p className="-mt-1 text-xs text-slate-500">{description}</p>
			) : null}
			<div className="grid gap-2 sm:grid-cols-2">
				{options.map((option) => {
					const id = `${name}-${option}`;
					return (
						<label
							key={option}
							htmlFor={id}
							className="flex items-center gap-2.5 rounded-md border border-slate-200 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 has-[:checked]:text-emerald-900"
						>
							<input
								id={id}
								type="checkbox"
								name={name}
								value={option}
								checked={values.includes(option)}
								onChange={() => toggle(option)}
								className="h-4 w-4 shrink-0 rounded border-slate-300 accent-emerald-700 focus:ring-emerald-600/40"
							/>
							{option}
						</label>
					);
				})}
			</div>
		</fieldset>
	);
}
