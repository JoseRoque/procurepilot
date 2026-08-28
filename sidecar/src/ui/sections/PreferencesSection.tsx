import { useEffect, useState } from "react";
import type { ShoppingPreferences } from "../../../../packages/domain/src";
import { DEFAULT_PREFERENCES, MAX_ACTIONS_PER_PLAN } from "../../../../packages/domain/src";
import { formatCents, normalizeMoney } from "../../../../packages/optimizer/src";
import type { Ctx } from "../App";

export function PreferencesSection({ ctx }: { ctx: Ctx }) {
	const [prefs, setPrefs] = useState<ShoppingPreferences>(DEFAULT_PREFERENCES);
	const [maxAddText, setMaxAddText] = useState("");
	const [status, setStatus] = useState("");

	useEffect(() => {
		ctx.core.profile.get().then((profile) => {
			setPrefs(profile.preferences);
			setMaxAddText(formatCents(profile.preferences.maxSingleAddCents));
		});
	}, [ctx.refreshKey]);

	async function save() {
		const maxSingleAddCents = normalizeMoney(maxAddText)?.cents ?? prefs.maxSingleAddCents;
		const next = { ...prefs, maxSingleAddCents, localOnly: true as const };
		await ctx.core.profile.setPreferences(next);
		await ctx.core.ledger.append("preferences_saved", "local_profile", "profile", {
			optimizationGoal: next.optimizationGoal,
			maxActionsPerPlan: next.maxActionsPerPlan,
		});
		setPrefs(next);
		setStatus("Preferences saved.");
	}

	return (
		<div>
			<h2>Preferences & automation limits</h2>
			<p className="subtitle">These bound what the planner recommends and what actions can ever be proposed.</p>

			<div className="card">
				<div className="grid2">
					<label>Optimize for
						<select value={prefs.optimizationGoal} onChange={(e) => setPrefs({ ...prefs, optimizationGoal: e.target.value as ShoppingPreferences["optimizationGoal"] })}>
							<option value="lowest_final_total">Lowest final total</option>
							<option value="lowest_immediate_payment">Lowest immediate payment</option>
							<option value="fewest_merchants">Fewest merchants</option>
							<option value="fastest_fulfillment">Fastest fulfillment</option>
						</select>
					</label>
					<label>Acceptable threshold fillers
						<select value={prefs.thresholdFillerPolicy} onChange={(e) => setPrefs({ ...prefs, thresholdFillerPolicy: e.target.value as ShoppingPreferences["thresholdFillerPolicy"] })}>
							<option value="household_essentials">Household essentials</option>
							<option value="pantry_staples">Pantry staples</option>
							<option value="none">None</option>
						</select>
					</label>
					<label>Substitution tolerance
						<select value={prefs.substitutionTolerance} onChange={(e) => setPrefs({ ...prefs, substitutionTolerance: e.target.value as ShoppingPreferences["substitutionTolerance"] })}>
							<option value="exact_only">Exact only</option>
							<option value="brand_preferred">Brand preferred</option>
							<option value="equivalent_allowed">Equivalent allowed</option>
						</select>
					</label>
					<label>Max approved actions per plan (hard cap {MAX_ACTIONS_PER_PLAN})
						<input type="number" min={0} max={MAX_ACTIONS_PER_PLAN} value={prefs.maxActionsPerPlan}
							onChange={(e) => setPrefs({ ...prefs, maxActionsPerPlan: Math.min(MAX_ACTIONS_PER_PLAN, Math.max(0, Number(e.target.value) || 0)) })} />
					</label>
					<label>Max single item addition
						<input value={maxAddText} onChange={(e) => setMaxAddText(e.target.value)} placeholder="$20.00" />
					</label>
					<label>Demo mode
						<input type="checkbox" checked={prefs.demoModeEnabled} onChange={(e) => setPrefs({ ...prefs, demoModeEnabled: e.target.checked })} />
					</label>
				</div>
				<div className="notice" style={{ marginTop: 12 }}>
					Local-only mode is <strong>always on</strong> in this version. Redacted contribution is a separate
					explicit opt-in under Privacy & sync. No preference can enable checkout automation — none exists.
				</div>
				<button className="primary" type="button" onClick={save}>Save preferences</button>
				<div className="statusline">{status}</div>
			</div>
		</div>
	);
}
