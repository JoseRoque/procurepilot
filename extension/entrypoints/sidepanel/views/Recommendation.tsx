import { formatCents } from "@/lib/money";
import { Badge } from "../components/Badge";
import { Section } from "../components/Section";
import type { CartRecommendation, ScanConfidence } from "@/lib/types";

const ACTION_LABEL: Record<CartRecommendation["action"], string> = {
	review_before_checkout: "Review before checkout",
	add_threshold_filler: "Consider adding a filler item",
	compare_saved_carts: "Compare saved carts",
	wait_for_more_information: "Wait for more information",
	no_action: "No action needed",
};

const CONFIDENCE_TONE: Record<ScanConfidence, "success" | "warning" | "neutral"> = {
	high: "success",
	medium: "warning",
	low: "neutral",
};

export function Recommendation({ recommendation }: { recommendation: CartRecommendation }) {
	return (
		<Section title="Recommendation">
			<div className="flex items-start justify-between gap-3">
				<h3 className="text-base font-semibold text-slate-900">{recommendation.headline}</h3>
				<Badge tone={CONFIDENCE_TONE[recommendation.confidence]}>{recommendation.confidence}</Badge>
			</div>

			<Badge tone="neutral">{ACTION_LABEL[recommendation.action]}</Badge>

			{recommendation.estimatedSavingsCents !== undefined ? (
				<p className="mt-3 text-sm font-medium text-emerald-700">
					Estimated impact: {formatCents(recommendation.estimatedSavingsCents)}
				</p>
			) : null}

			<ul className="mt-3 space-y-1.5 text-sm text-slate-700">
				{recommendation.rationale.map((line, index) => (
					<li key={index}>• {line}</li>
				))}
			</ul>

			{recommendation.warnings.length > 0 ? (
				<div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
					{recommendation.warnings.map((warning, index) => (
						<p key={index}>{warning}</p>
					))}
				</div>
			) : null}

			<p className="mt-4 border-t border-slate-100 pt-3 text-center text-xs font-medium text-slate-500">
				Review before checkout — this extension never places orders or handles payment.
			</p>
		</Section>
	);
}
