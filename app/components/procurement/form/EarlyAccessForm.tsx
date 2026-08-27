import { useState } from "react";
import { CtaButton } from "~/components/procurement/CtaButton";
import { CheckboxField } from "~/components/procurement/form/CheckboxField";
import { CheckboxGroup } from "~/components/procurement/form/CheckboxGroup";
import { FIELD_INPUT_CLASSES, FormField } from "~/components/procurement/form/FormField";
import {
	BIGGEST_CHALLENGE_OPTIONS,
	COMPANY_SIZE_OPTIONS,
	PRIMARY_CATEGORY_OPTIONS,
	PURCHASING_CHANNEL_OPTIONS,
	validateProcurementEarlyAccessInput,
} from "~/lib/validation/procurementEarlyAccess";
import type {
	ProcurementApiResponse,
	ProcurementEarlyAccessFieldErrors,
	ProcurementSubmitSuccessData,
} from "~/types/procurement";

type FormValues = {
	workEmail: string;
	fullName: string;
	companyName: string;
	jobTitle: string;
	companySize: string;
	annualAddressableSpend: string;
	procurementMaturity: string;
	primaryCategories: string[];
	purchasingChannels: string[];
	biggestChallenge: string;
	currentSystems: string;
	browserExtensionInterest: boolean;
	pilotInterest: boolean;
	notes: string;
};

const INITIAL_VALUES: FormValues = {
	workEmail: "",
	fullName: "",
	companyName: "",
	jobTitle: "",
	companySize: "",
	annualAddressableSpend: "",
	procurementMaturity: "",
	primaryCategories: [],
	purchasingChannels: [],
	biggestChallenge: "",
	currentSystems: "",
	browserExtensionInterest: false,
	pilotInterest: false,
	notes: "",
};

type Status = "idle" | "submitting" | "error";

export function EarlyAccessForm({ onSuccess }: { onSuccess: () => void }) {
	const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
	const [status, setStatus] = useState<Status>("idle");
	const [fieldErrors, setFieldErrors] = useState<ProcurementEarlyAccessFieldErrors>({});
	const [formError, setFormError] = useState<string | undefined>();

	function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
		setValues((prev) => ({ ...prev, [key]: value }));
	}

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(undefined);

		const validation = validateProcurementEarlyAccessInput(values);
		if (!validation.success) {
			setFieldErrors(validation.fields);
			setFormError("Please correct the highlighted fields.");
			return;
		}

		setFieldErrors({});
		setStatus("submitting");

		try {
			const response = await fetch("/api/procurement-early-access", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(validation.data),
			});
			const payload = (await response.json()) as ProcurementApiResponse<ProcurementSubmitSuccessData>;

			if (!response.ok || !payload.ok) {
				const errorPayload = !payload.ok ? payload.error : undefined;
				setFieldErrors(errorPayload?.fields ?? {});
				setFormError(
					errorPayload?.message ??
						"Something went wrong submitting the form. Please try again.",
				);
				setStatus("error");
				return;
			}

			onSuccess();
		} catch {
			setFormError(
				"We couldn't reach the server. Check your connection and try again.",
			);
			setStatus("error");
		}
	}

	const isSubmitting = status === "submitting";

	return (
		<form noValidate onSubmit={handleSubmit} className="space-y-8">
			{formError ? (
				<div
					role="alert"
					className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
				>
					{formError}
				</div>
			) : null}

			<div className="grid gap-5 sm:grid-cols-2">
				<FormField id="fullName" label="Full name" required error={fieldErrors.fullName?.[0]}>
					<input
						id="fullName"
						name="fullName"
						type="text"
						autoComplete="name"
						maxLength={120}
						required
						aria-required="true"
						aria-invalid={Boolean(fieldErrors.fullName)}
						aria-describedby={fieldErrors.fullName ? "fullName-error" : undefined}
						value={values.fullName}
						onChange={(event) => update("fullName", event.target.value)}
						className={FIELD_INPUT_CLASSES}
					/>
				</FormField>

				<FormField id="workEmail" label="Work email" required error={fieldErrors.workEmail?.[0]}>
					<input
						id="workEmail"
						name="workEmail"
						type="email"
						autoComplete="email"
						maxLength={254}
						required
						aria-required="true"
						aria-invalid={Boolean(fieldErrors.workEmail)}
						aria-describedby={fieldErrors.workEmail ? "workEmail-error" : undefined}
						value={values.workEmail}
						onChange={(event) => update("workEmail", event.target.value)}
						className={FIELD_INPUT_CLASSES}
					/>
				</FormField>

				<FormField id="companyName" label="Company name" required error={fieldErrors.companyName?.[0]}>
					<input
						id="companyName"
						name="companyName"
						type="text"
						autoComplete="organization"
						maxLength={160}
						required
						aria-required="true"
						aria-invalid={Boolean(fieldErrors.companyName)}
						aria-describedby={fieldErrors.companyName ? "companyName-error" : undefined}
						value={values.companyName}
						onChange={(event) => update("companyName", event.target.value)}
						className={FIELD_INPUT_CLASSES}
					/>
				</FormField>

				<FormField id="jobTitle" label="Job title" required error={fieldErrors.jobTitle?.[0]}>
					<input
						id="jobTitle"
						name="jobTitle"
						type="text"
						autoComplete="organization-title"
						maxLength={160}
						required
						aria-required="true"
						aria-invalid={Boolean(fieldErrors.jobTitle)}
						aria-describedby={fieldErrors.jobTitle ? "jobTitle-error" : undefined}
						value={values.jobTitle}
						onChange={(event) => update("jobTitle", event.target.value)}
						className={FIELD_INPUT_CLASSES}
					/>
				</FormField>

				<FormField id="companySize" label="Company size" required error={fieldErrors.companySize?.[0]}>
					<select
						id="companySize"
						name="companySize"
						required
						aria-required="true"
						aria-invalid={Boolean(fieldErrors.companySize)}
						aria-describedby={fieldErrors.companySize ? "companySize-error" : undefined}
						value={values.companySize}
						onChange={(event) => update("companySize", event.target.value)}
						className={FIELD_INPUT_CLASSES}
					>
						<option value="" disabled>
							Select company size
						</option>
						{COMPANY_SIZE_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label} employees
							</option>
						))}
					</select>
				</FormField>

				<FormField
					id="biggestChallenge"
					label="Biggest purchasing challenge"
					required
					error={fieldErrors.biggestChallenge?.[0]}
				>
					<select
						id="biggestChallenge"
						name="biggestChallenge"
						required
						aria-required="true"
						aria-invalid={Boolean(fieldErrors.biggestChallenge)}
						aria-describedby={
							fieldErrors.biggestChallenge ? "biggestChallenge-error" : undefined
						}
						value={values.biggestChallenge}
						onChange={(event) => update("biggestChallenge", event.target.value)}
						className={FIELD_INPUT_CLASSES}
					>
						<option value="" disabled>
							Select the biggest challenge
						</option>
						{BIGGEST_CHALLENGE_OPTIONS.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
				</FormField>
			</div>

			<div className="grid gap-5 sm:grid-cols-2">
				<FormField
					id="annualAddressableSpend"
					label="Annual addressable spend"
					description="Optional. Rough estimate is fine, e.g. $2M–$5M."
					error={fieldErrors.annualAddressableSpend?.[0]}
				>
					<input
						id="annualAddressableSpend"
						name="annualAddressableSpend"
						type="text"
						maxLength={100}
						aria-invalid={Boolean(fieldErrors.annualAddressableSpend)}
						value={values.annualAddressableSpend}
						onChange={(event) =>
							update("annualAddressableSpend", event.target.value)
						}
						className={FIELD_INPUT_CLASSES}
					/>
				</FormField>

				<FormField
					id="procurementMaturity"
					label="Procurement process maturity"
					description="Optional. e.g. ad-hoc, centralizing, mature."
					error={fieldErrors.procurementMaturity?.[0]}
				>
					<input
						id="procurementMaturity"
						name="procurementMaturity"
						type="text"
						maxLength={100}
						aria-invalid={Boolean(fieldErrors.procurementMaturity)}
						value={values.procurementMaturity}
						onChange={(event) => update("procurementMaturity", event.target.value)}
						className={FIELD_INPUT_CLASSES}
					/>
				</FormField>
			</div>

			<CheckboxGroup
				legend="Primary spend categories"
				description="Optional. Select all that apply."
				name="primaryCategories"
				options={PRIMARY_CATEGORY_OPTIONS}
				values={values.primaryCategories}
				onChange={(next) => update("primaryCategories", next)}
			/>

			<CheckboxGroup
				legend="Purchasing channels in use today"
				description="Optional. Select all that apply."
				name="purchasingChannels"
				options={PURCHASING_CHANNEL_OPTIONS}
				values={values.purchasingChannels}
				onChange={(next) => update("purchasingChannels", next)}
			/>

			<FormField
				id="currentSystems"
				label="Current systems"
				description="Optional. ERP, P2P, or supplier tools currently in use."
				error={fieldErrors.currentSystems?.[0]}
			>
				<input
					id="currentSystems"
					name="currentSystems"
					type="text"
					maxLength={1000}
					aria-invalid={Boolean(fieldErrors.currentSystems)}
					value={values.currentSystems}
					onChange={(event) => update("currentSystems", event.target.value)}
					className={FIELD_INPUT_CLASSES}
				/>
			</FormField>

			<div className="grid gap-3 sm:grid-cols-2">
				<CheckboxField
					id="browserExtensionInterest"
					name="browserExtensionInterest"
					label="Interested in a lightweight browser extension for point-of-purchase guidance"
					checked={values.browserExtensionInterest}
					onChange={(checked) => update("browserExtensionInterest", checked)}
				/>
				<CheckboxField
					id="pilotInterest"
					name="pilotInterest"
					label="Interested in participating in an early pilot"
					checked={values.pilotInterest}
					onChange={(checked) => update("pilotInterest", checked)}
				/>
			</div>

			<FormField
				id="notes"
				label="Anything else we should know?"
				description="Optional. Please avoid confidential procurement, supplier, or account information."
				error={fieldErrors.notes?.[0]}
			>
				<textarea
					id="notes"
					name="notes"
					rows={4}
					maxLength={2000}
					aria-invalid={Boolean(fieldErrors.notes)}
					value={values.notes}
					onChange={(event) => update("notes", event.target.value)}
					className={FIELD_INPUT_CLASSES}
				/>
			</FormField>

			<div>
				<CtaButton as="button" type="submit" size="lg" disabled={isSubmitting} className="w-full sm:w-auto">
					{isSubmitting ? "Submitting…" : "Request early access"}
				</CtaButton>
				<p className="mt-4 text-xs leading-5 text-slate-500">
					We will use your details only to follow up about early access and
					research participation. Do not submit confidential procurement,
					supplier, or account information.
				</p>
			</div>
		</form>
	);
}
