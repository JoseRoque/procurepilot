import { Badge } from "../components/Badge";
import { MoneyRow } from "../components/MoneyRow";
import { Section } from "../components/Section";
import type { CartSnapshot, ScanConfidence } from "@/lib/types";

const CONFIDENCE_TONE: Record<ScanConfidence, "success" | "warning" | "neutral"> = {
	high: "success",
	medium: "warning",
	low: "neutral",
};

const OFFER_STATUS_LABEL: Record<string, string> = {
	visible: "Visible",
	appears_applied: "Appears applied",
	unknown: "Not verified",
};

export function ScanResult({ snapshot }: { snapshot: CartSnapshot }) {
	return (
		<Section title="Scan result">
			<div className="flex items-center justify-between">
				<span className="text-sm text-slate-600">
					{snapshot.cartItemCount !== undefined ? `${snapshot.cartItemCount} items` : "Item count not detected"}
				</span>
				<Badge tone={CONFIDENCE_TONE[snapshot.confidence]}>{snapshot.confidence} confidence</Badge>
			</div>

			<div className="mt-3">
				<MoneyRow label="Subtotal" fact={snapshot.subtotal} />
				<MoneyRow label="Discounts" fact={snapshot.discounts} />
				<MoneyRow label="Delivery fee" fact={snapshot.deliveryFee} />
				<MoneyRow label="Service fee" fact={snapshot.serviceFee} />
				<MoneyRow label="Tax" fact={snapshot.tax} />
				<MoneyRow label="Visible credits" fact={snapshot.visibleCredits} />
				<MoneyRow label="Displayed final total" fact={snapshot.displayedFinalTotal} />
			</div>

			{snapshot.visibleOffers.length > 0 ? (
				<div className="mt-4">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detected offers</h3>
					<ul className="mt-2 space-y-2">
						{snapshot.visibleOffers.map((offer, index) => (
							<li key={`${offer.title}-${index}`} className="rounded-md bg-slate-50 p-2.5 text-sm">
								<div className="flex items-center justify-between gap-2">
									<span className="font-medium text-slate-800">{offer.title}</span>
									<Badge tone="neutral">{OFFER_STATUS_LABEL[offer.status]}</Badge>
								</div>
								<p className="mt-1 text-xs text-slate-500">{offer.rawText}</p>
							</li>
						))}
					</ul>
				</div>
			) : null}

			{snapshot.extractionNotes.length > 0 ? (
				<div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
					<p className="font-medium">Extraction notes</p>
					<ul className="mt-1 space-y-1">
						{snapshot.extractionNotes.map((note, index) => (
							<li key={index}>• {note}</li>
						))}
					</ul>
				</div>
			) : null}
		</Section>
	);
}
