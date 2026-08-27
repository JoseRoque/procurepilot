import { useMemo, useState } from "react";
import { createCartRecommendation } from "@/lib/engine";
import { DEMO_FIXTURES, DEMO_FIXTURE_LABELS, type DemoFixtureKey } from "@/lib/demoFixtures";
import { completeCartSnapshot } from "@/lib/snapshotFactory";
import type { ShoppingPreferences } from "@/lib/types";
import { Section } from "../components/Section";
import { Recommendation } from "./Recommendation";
import { ScanResult } from "./ScanResult";

const FIXTURE_KEYS = Object.keys(DEMO_FIXTURE_LABELS) as DemoFixtureKey[];

export function Demo({ preferences }: { preferences: ShoppingPreferences }) {
	const [selectedKey, setSelectedKey] = useState<DemoFixtureKey>("below_threshold");

	const { snapshot, recommendation } = useMemo(() => {
		const demoSnapshot = completeCartSnapshot(DEMO_FIXTURES[selectedKey]);
		const demoRecommendation = createCartRecommendation(demoSnapshot, preferences, []);
		return { snapshot: demoSnapshot, recommendation: demoRecommendation };
	}, [selectedKey, preferences]);

	return (
		<div className="space-y-4">
			<Section title="Demo mode">
				<p className="text-sm text-slate-600">
					Try the recommendation engine with sample carts — no real store visit needed. Demo data never
					touches local storage or any real page.
				</p>
				<div className="mt-3 flex flex-col gap-1.5">
					{FIXTURE_KEYS.map((key) => (
						<label key={key} className="flex items-center gap-2 text-sm text-slate-700">
							<input
								type="radio"
								name="demo-fixture"
								checked={selectedKey === key}
								onChange={() => setSelectedKey(key)}
								className="h-3.5 w-3.5"
							/>
							{DEMO_FIXTURE_LABELS[key]}
						</label>
					))}
				</div>
			</Section>

			<ScanResult snapshot={snapshot} />
			<Recommendation recommendation={recommendation} />
		</div>
	);
}
