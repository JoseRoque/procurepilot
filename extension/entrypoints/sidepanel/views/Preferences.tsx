import { Section } from "../components/Section";
import type {
	OptimizationGoal,
	ShoppingPreferences,
	SubstitutionTolerance,
	ThresholdFillerPolicy,
} from "@/lib/types";

const OPTIMIZATION_GOALS: { value: OptimizationGoal; label: string }[] = [
	{ value: "lowest_total", label: "Lowest total" },
	{ value: "lowest_immediate_payment", label: "Lowest immediate payment" },
	{ value: "fewest_merchants", label: "Fewest merchants" },
	{ value: "fastest_fulfillment", label: "Fastest fulfillment" },
];

const FILLER_POLICIES: { value: ThresholdFillerPolicy; label: string }[] = [
	{ value: "household_essentials", label: "Household essentials" },
	{ value: "pantry_staples", label: "Pantry staples" },
	{ value: "none", label: "None" },
];

const SUBSTITUTION_TOLERANCES: { value: SubstitutionTolerance; label: string }[] = [
	{ value: "exact_only", label: "Exact only" },
	{ value: "brand_preferred", label: "Brand preferred" },
	{ value: "equivalent_allowed", label: "Equivalent allowed" },
];

function RadioGroup<T extends string>({
	legend,
	options,
	value,
	onChange,
}: {
	legend: string;
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<fieldset className="mb-4">
			<legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">{legend}</legend>
			<div className="mt-2 space-y-1.5">
				{options.map((option) => (
					<label key={option.value} className="flex items-center gap-2 text-sm text-slate-700">
						<input
							type="radio"
							name={legend}
							checked={value === option.value}
							onChange={() => onChange(option.value)}
							className="h-3.5 w-3.5"
						/>
						{option.label}
					</label>
				))}
			</div>
		</fieldset>
	);
}

export function Preferences({
	preferences,
	onChange,
}: {
	preferences: ShoppingPreferences;
	onChange: (patch: Partial<ShoppingPreferences>) => void;
}) {
	return (
		<Section title="Preferences">
			<RadioGroup
				legend="Optimize for"
				options={OPTIMIZATION_GOALS}
				value={preferences.optimizationGoal}
				onChange={(optimizationGoal) => onChange({ optimizationGoal })}
			/>
			<RadioGroup
				legend="Acceptable threshold fillers"
				options={FILLER_POLICIES}
				value={preferences.thresholdFillerPolicy}
				onChange={(thresholdFillerPolicy) => onChange({ thresholdFillerPolicy })}
			/>
			<RadioGroup
				legend="Substitution tolerance"
				options={SUBSTITUTION_TOLERANCES}
				value={preferences.substitutionTolerance}
				onChange={(substitutionTolerance) => onChange({ substitutionTolerance })}
			/>

			<label className="flex items-center gap-2 text-sm text-slate-700">
				<input
					type="checkbox"
					checked={preferences.demoModeEnabled}
					onChange={(event) => onChange({ demoModeEnabled: event.target.checked })}
					className="h-3.5 w-3.5"
				/>
				Enable demo mode
			</label>

			<div className="mt-4 flex items-center justify-between rounded-md bg-slate-50 p-2.5 text-xs">
				<span className="text-slate-600">Local-only mode</span>
				<span className="font-medium text-slate-800">Always on in this version</span>
			</div>
			<div className="mt-2 flex items-center justify-between rounded-md bg-slate-50 p-2.5 text-xs">
				<span className="text-slate-600">Cloud sync</span>
				<span className="font-medium text-slate-800">Coming later; disabled in this version</span>
			</div>
		</Section>
	);
}
