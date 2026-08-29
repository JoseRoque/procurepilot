import { useCallback, useEffect, useState } from "react";
import type { DealRecipe, RecipeApplicability, RecipeEvaluation } from "../../../../packages/domain/src";
import {
	assessApplicability,
	evaluateRecipe,
	type CartFacts,
} from "../../../../packages/optimizer/src";
import {
	deleteRecipe,
	exportRecipe,
	listRecipes,
	getMemberships,
	parseImportedRecipe,
	saveRecipe,
	setMemberships,
} from "@/lib/storage/recipes";
import type { CartSnapshot } from "@/lib/types";

/**
 * Deal recipes: pre-screen whether a shared deal can work for you, then check
 * a scanned cart against it.
 *
 * Deliberately shows applicability before any scan. The complaint this
 * addresses is finding out a deal does not apply after building the whole
 * cart, so the verdict has to be reachable without one.
 */

const VERDICT_STYLE: Record<RecipeApplicability["verdict"], string> = {
	likely_applicable: "border-emerald-300 bg-emerald-50",
	needs_info: "border-amber-300 bg-amber-50",
	not_applicable: "border-slate-300 bg-slate-100",
};

const VERDICT_LABEL: Record<RecipeApplicability["verdict"], string> = {
	likely_applicable: "Looks usable",
	needs_info: "Needs your input",
	not_applicable: "Not usable for you",
};

const STATUS_STYLE: Record<string, string> = {
	present: "text-emerald-700",
	missing: "text-slate-500",
	insufficient_quantity: "text-amber-700",
	substituted: "text-amber-700",
};

function snapshotToCartFacts(snapshot: CartSnapshot): CartFacts {
	return {
		merchantId: snapshot.platform,
		subtotalCents: snapshot.subtotal?.cents,
		// The scanner does not extract product codes, so identity-dependent
		// conditions ("3 participating items") will correctly report as
		// uncheckable rather than being guessed from names.
		lines: snapshot.items.map((line) => ({
			displayName: line.displayName,
			quantity: line.quantity,
			unitPriceCents: line.unitPriceCents,
			lineTotalCents: line.lineTotalCents,
		})),
	};
}

export function RecipesTab({ snapshot }: { snapshot?: CartSnapshot }) {
	const [memberships, setMembershipList] = useState<string[]>([]);
	const [membershipDraft, setMembershipDraft] = useState("");
	const [recipes, setRecipes] = useState<DealRecipe[]>([]);
	const [selected, setSelected] = useState<DealRecipe>();
	const [importText, setImportText] = useState("");
	const [status, setStatus] = useState<{ text: string; isError: boolean }>();

	const reload = useCallback(() => {
		listRecipes().then(setRecipes);
	}, []);

	useEffect(() => {
		reload();
		getMemberships().then(setMembershipList);
	}, [reload]);

	function addMembership() {
		const next = [...memberships, membershipDraft];
		setMemberships(next).then(() => {
			getMemberships().then(setMembershipList);
			setMembershipDraft("");
		});
	}

	function removeMembership(name: string) {
		const next = memberships.filter((entry) => entry !== name);
		setMemberships(next).then(() => getMemberships().then(setMembershipList));
	}

	function onImport() {
		const result = parseImportedRecipe(importText.trim());
		if (!result.ok) {
			setStatus({ text: result.reason, isError: true });
			return;
		}
		saveRecipe(result.recipe).then(() => {
			setImportText("");
			setStatus({ text: `Imported "${result.recipe.title}".`, isError: false });
			reload();
		});
	}

	const applicability = selected
		? assessApplicability(selected, { memberships }, new Date().toISOString())
		: undefined;

	const evaluation: RecipeEvaluation | undefined =
		selected && snapshot ? evaluateRecipe(selected, snapshotToCartFacts(snapshot)) : undefined;

	return (
		<div className="space-y-4">
			<section className="rounded-xl border border-slate-200 bg-white p-4">
				<h2 className="text-sm font-semibold text-slate-900">Deal recipes</h2>
				<p className="mt-1 text-xs text-slate-500">
					A recipe is a shared cart setup: the items, the conditions the deal depends on, and the
					order they need to happen in. Recipes stay on this device unless you export one.
				</p>
			</section>

			<section className="rounded-xl border border-slate-200 bg-white p-4">
				<h3 className="text-xs font-semibold text-slate-900">Import a recipe</h3>
				<textarea
					value={importText}
					onChange={(event) => setImportText(event.target.value)}
					placeholder="Paste recipe JSON shared with you"
					rows={3}
					className="mt-2 w-full rounded-md border border-slate-300 p-2 text-xs"
				/>
				<button
					type="button"
					onClick={onImport}
					disabled={!importText.trim()}
					className="mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
				>
					Import
				</button>
				{status ? (
					<p className={`mt-2 text-xs ${status.isError ? "text-red-700" : "text-slate-600"}`}>
						{status.text}
					</p>
				) : null}
			</section>

			<section className="rounded-xl border border-slate-200 bg-white p-4">
				<h3 className="text-xs font-semibold text-slate-900">Your memberships</h3>
				<p className="mt-1 text-xs text-slate-500">
					Used to tell you upfront when a deal needs a program you do not have. This app cannot
					detect memberships — it only knows what you enter here.
				</p>
				<div className="mt-2 flex gap-2">
					<input
						value={membershipDraft}
						onChange={(event) => setMembershipDraft(event.target.value)}
						placeholder="e.g. Store Plus"
						className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
					/>
					<button
						type="button"
						onClick={addMembership}
						disabled={!membershipDraft.trim()}
						className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-40"
					>
						Add
					</button>
				</div>
				{memberships.length > 0 ? (
					<ul className="mt-2 flex flex-wrap gap-1">
						{memberships.map((name) => (
							<li key={name}>
								<button
									type="button"
									onClick={() => removeMembership(name)}
									title="Remove"
									className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-200"
								>
									{name} ×
								</button>
							</li>
						))}
					</ul>
				) : null}
			</section>

			<section className="rounded-xl border border-slate-200 bg-white p-4">
				<h3 className="text-xs font-semibold text-slate-900">Saved recipes ({recipes.length})</h3>
				{recipes.length === 0 ? (
					<p className="mt-2 text-xs text-slate-500">
						No recipes yet. Paste one above to get started.
					</p>
				) : (
					<ul className="mt-2 space-y-1">
						{recipes.map((recipe) => (
							<li key={recipe.recipeId}>
								<button
									type="button"
									onClick={() => setSelected(recipe)}
									className={`w-full rounded-md border p-2 text-left text-xs ${
										selected?.recipeId === recipe.recipeId
											? "border-slate-900 bg-slate-50"
											: "border-slate-200 hover:bg-slate-50"
									}`}
								>
									<span className="font-medium text-slate-900">{recipe.title}</span>
									<span className="block text-slate-500">
										{recipe.merchantId} · {recipe.items.length} items ·{" "}
										{recipe.terms.length} conditions
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</section>

			{selected && applicability ? (
				<section className={`rounded-xl border p-4 ${VERDICT_STYLE[applicability.verdict]}`}>
					<div className="flex items-start justify-between gap-2">
						<div>
							<h3 className="text-sm font-semibold text-slate-900">{selected.title}</h3>
							<p className="text-xs font-medium text-slate-700">
								{VERDICT_LABEL[applicability.verdict]}
							</p>
						</div>
						{applicability.expiresInDays !== undefined && applicability.expiresInDays <= 7 ? (
							<span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
								{applicability.expiresInDays === 0
									? "Last day"
									: `${applicability.expiresInDays}d left`}
							</span>
						) : null}
					</div>

					<ul className="mt-2 space-y-1 text-xs text-slate-700">
						{applicability.explanation.map((line, index) => (
							<li key={index}>{line}</li>
						))}
					</ul>

					{applicability.requiresConfirmation.length > 0 ? (
						<div className="mt-3">
							<p className="text-xs font-semibold text-slate-900">You need to confirm or do:</p>
							<ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-700">
								{applicability.requiresConfirmation.map((entry, index) => (
									<li key={index}>{entry.explanation}</li>
								))}
							</ul>
						</div>
					) : null}

					{selected.steps.length > 0 ? (
						<div className="mt-3">
							<p className="text-xs font-semibold text-slate-900">Steps, in order:</p>
							<ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-slate-700">
								{selected.steps.map((step, index) => (
									<li key={index}>{step}</li>
								))}
							</ol>
						</div>
					) : null}

					<div className="mt-3 flex gap-2">
						<button
							type="button"
							onClick={() => navigator.clipboard?.writeText(exportRecipe(selected))}
							className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
						>
							Copy to share
						</button>
						<button
							type="button"
							onClick={() =>
								deleteRecipe(selected.recipeId).then(() => {
									setSelected(undefined);
									reload();
								})
							}
							className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
						>
							Delete
						</button>
					</div>
				</section>
			) : null}

			{selected ? (
				<section className="rounded-xl border border-slate-200 bg-white p-4">
					<h3 className="text-xs font-semibold text-slate-900">Against your cart</h3>
					{!snapshot ? (
						<p className="mt-2 text-xs text-slate-500">
							Scan the cart page on {selected.merchantId} to check what is missing.
						</p>
					) : evaluation ? (
						<>
							{evaluation.warnings.map((warning, index) => (
								<p key={index} className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
									{warning}
								</p>
							))}

							<ul className="mt-2 space-y-1 text-xs">
								{evaluation.items.map((entry, index) => (
									<li key={index} className={STATUS_STYLE[entry.status] ?? "text-slate-600"}>
										{entry.explanation}
									</li>
								))}
							</ul>

							<p className="mt-3 text-xs font-semibold text-slate-900">Conditions</p>
							<ul className="mt-1 space-y-1 text-xs">
								{evaluation.terms.map((entry, index) => (
									<li
										key={index}
										className={
											entry.status === "met"
												? "text-emerald-700"
												: entry.status === "not_met"
													? "text-red-700"
													: "text-slate-600"
										}
									>
										{entry.explanation}
									</li>
								))}
							</ul>

							<ul className="mt-3 space-y-1 text-xs text-slate-700">
								{evaluation.explanation.map((line, index) => (
									<li key={index}>{line}</li>
								))}
							</ul>
						</>
					) : null}
				</section>
			) : null}
		</div>
	);
}
