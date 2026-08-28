import type {
	ActionApproval,
	ActionResultInput,
	CartSnapshot,
	ConsentReceipt,
	PrivacyMode,
	ProposedAction,
	PurchasePlan,
	ShoppingItem,
	ShoppingItemInput,
	ShoppingPreferences,
} from "../../../packages/domain/src";
import { DEFAULT_PREFERENCES, normalizeItemName } from "../../../packages/domain/src";
import { calculateObservedTotal } from "../../../packages/optimizer/src";
import type { ConfigurationPack } from "../../../packages/config-kit/src/types";
import type { Db, FieldCrypto } from "./db";

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------- profile

export class ProfileRepo {
	constructor(private readonly db: Db) {}

	async get(): Promise<{
		pseudonymousDeviceId: string;
		deviceToken?: string;
		appVersion: string;
		preferences: ShoppingPreferences;
	}> {
		const rows = await this.db.query("SELECT * FROM local_profile LIMIT 1");
		const row = rows[0];
		if (!row) throw new Error("local_profile missing — sidecar not initialized");
		const stored = JSON.parse((row.preferences_json as string) || "{}");
		return {
			pseudonymousDeviceId: row.pseudonymous_device_id as string,
			deviceToken: (row.device_token as string | null) ?? undefined,
			appVersion: row.app_version as string,
			preferences: { ...DEFAULT_PREFERENCES, ...stored, localOnly: true },
		};
	}

	async setPreferences(preferences: ShoppingPreferences): Promise<void> {
		await this.db.execute(
			"UPDATE local_profile SET preferences_json = ?, updated_at = ?",
			[JSON.stringify({ ...preferences, localOnly: true }), nowIso()],
		);
	}

	async setDeviceToken(token: string): Promise<void> {
		await this.db.execute("UPDATE local_profile SET device_token = ?, updated_at = ?", [
			token,
			nowIso(),
		]);
	}
}

// ---------------------------------------------------------- shopping items

export class ShoppingItemsRepo {
	constructor(
		private readonly db: Db,
		private readonly crypto: FieldCrypto,
	) {}

	async upsert(input: ShoppingItemInput): Promise<ShoppingItem> {
		const id = input.id ?? crypto.randomUUID();
		const timestamp = nowIso();
		const normalized = normalizeItemName(input.name);
		const encName = await this.crypto.encrypt(input.name);
		const encNormalized = await this.crypto.encrypt(normalized);
		const encBrand = input.preferredBrand
			? await this.crypto.encrypt(input.preferredBrand)
			: null;
		const existing = await this.db.query("SELECT id, created_at FROM shopping_items WHERE id = ?", [id]);
		if (existing.length > 0) {
			await this.db.execute(
				`UPDATE shopping_items SET name=?, normalized_name=?, urgency=?, target_quantity=?, acceptable_substitution=?,
				 max_unit_price_cents=?, preferred_brand=?, category_hint=?, active=?, updated_at=? WHERE id=?`,
				[
					encName,
					encNormalized,
					input.urgency,
					input.targetQuantity,
					input.acceptableSubstitution,
					input.maxUnitPriceCents ?? null,
					encBrand,
					input.categoryHint ?? null,
					input.active ? 1 : 0,
					timestamp,
					id,
				],
			);
		} else {
			await this.db.execute(
				`INSERT INTO shopping_items (id, name, normalized_name, urgency, target_quantity, acceptable_substitution,
				 max_unit_price_cents, preferred_brand, category_hint, active, created_at, updated_at)
				 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
				[
					id,
					encName,
					encNormalized,
					input.urgency,
					input.targetQuantity,
					input.acceptableSubstitution,
					input.maxUnitPriceCents ?? null,
					encBrand,
					input.categoryHint ?? null,
					input.active ? 1 : 0,
					timestamp,
					timestamp,
				],
			);
		}
		const item = (await this.list()).find((candidate) => candidate.id === id);
		if (!item) throw new Error("failed to read back shopping item");
		return item;
	}

	async list(): Promise<ShoppingItem[]> {
		const rows = await this.db.query("SELECT * FROM shopping_items ORDER BY created_at ASC");
		const items: ShoppingItem[] = [];
		for (const row of rows) {
			const name = await this.crypto.decrypt(row.name as string);
			items.push({
				id: row.id as string,
				name,
				normalizedName: normalizeItemName(name),
				urgency: row.urgency as ShoppingItem["urgency"],
				targetQuantity: row.target_quantity as number,
				acceptableSubstitution: row.acceptable_substitution as ShoppingItem["acceptableSubstitution"],
				maxUnitPriceCents: (row.max_unit_price_cents as number | null) ?? undefined,
				preferredBrand: row.preferred_brand
					? await this.crypto.decrypt(row.preferred_brand as string)
					: undefined,
				categoryHint: (row.category_hint as string | null) ?? undefined,
				active: (row.active as number) === 1,
				createdAt: row.created_at as string,
				updatedAt: row.updated_at as string,
			});
		}
		return items;
	}

	async remove(id: string): Promise<void> {
		await this.db.execute("DELETE FROM item_preferences WHERE shopping_item_id = ?", [id]);
		await this.db.execute("DELETE FROM shopping_items WHERE id = ?", [id]);
	}
}

// ------------------------------------------------------------- snapshots

export class SnapshotsRepo {
	constructor(
		private readonly db: Db,
		private readonly crypto: FieldCrypto,
	) {}

	async save(snapshot: CartSnapshot, privacyMode: PrivacyMode): Promise<void> {
		const encItems = await this.crypto.encrypt(JSON.stringify(snapshot.items));
		await this.db.execute(
			`INSERT OR REPLACE INTO cart_snapshots (id, created_at, platform, platform_label, page_url_origin, page_path_hint,
			 item_count, items_json, subtotal_cents, discounts_cents, delivery_fee_cents, service_fee_cents, tax_cents,
			 visible_credits_cents, displayed_final_total_cents, calculated_total_cents, confidence, extraction_notes_json,
			 adapter_version, privacy_mode, raw_html_stored, cookies_read)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0)`,
			[
				snapshot.id,
				snapshot.createdAt,
				snapshot.platform,
				snapshot.platformLabel,
				snapshot.pageUrlOrigin,
				snapshot.pagePathHint ?? null,
				snapshot.cartItemCount ?? null,
				encItems,
				snapshot.subtotal?.cents ?? null,
				snapshot.discounts?.cents ?? null,
				snapshot.deliveryFee?.cents ?? null,
				snapshot.serviceFee?.cents ?? null,
				snapshot.tax?.cents ?? null,
				snapshot.visibleCredits?.cents ?? null,
				snapshot.displayedFinalTotal?.cents ?? null,
				calculateObservedTotal(snapshot) ?? null,
				snapshot.confidence,
				JSON.stringify(snapshot.extractionNotes),
				snapshot.adapterVersion ?? null,
				privacyMode,
			],
		);
		await this.db.execute("DELETE FROM visible_offers WHERE snapshot_id = ?", [snapshot.id]);
		for (const offer of snapshot.visibleOffers) {
			await this.db.execute(
				`INSERT INTO visible_offers (id, snapshot_id, title, raw_text, offer_type, minimum_spend_cents,
				 discount_cents, discount_percent, maximum_discount_cents, status, confidence)
				 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
				[
					crypto.randomUUID(),
					snapshot.id,
					offer.title,
					await this.crypto.encrypt(offer.rawText),
					offer.offerType,
					offer.minimumSpendCents ?? null,
					offer.discountCents ?? null,
					offer.discountPercent ?? null,
					offer.maximumDiscountCents ?? null,
					offer.status,
					offer.confidence,
				],
			);
		}
	}

	async get(id: string): Promise<CartSnapshot | undefined> {
		const rows = await this.db.query("SELECT * FROM cart_snapshots WHERE id = ?", [id]);
		const row = rows[0];
		if (!row) return undefined;
		return this.hydrate(row);
	}

	async list(limit = 20): Promise<CartSnapshot[]> {
		const rows = await this.db.query(
			"SELECT * FROM cart_snapshots ORDER BY created_at DESC LIMIT ?",
			[limit],
		);
		const snapshots: CartSnapshot[] = [];
		for (const row of rows) snapshots.push(await this.hydrate(row));
		return snapshots;
	}

	private async hydrate(row: Record<string, unknown>): Promise<CartSnapshot> {
		const money = (cents: unknown) =>
			cents === null || cents === undefined
				? undefined
				: ({ currency: "USD" as const, cents: cents as number });
		const offerRows = await this.db.query("SELECT * FROM visible_offers WHERE snapshot_id = ?", [
			row.id,
		]);
		const visibleOffers = [];
		for (const offer of offerRows) {
			visibleOffers.push({
				title: offer.title as string,
				rawText: await this.crypto.decrypt(offer.raw_text as string),
				offerType: offer.offer_type as CartSnapshot["visibleOffers"][number]["offerType"],
				minimumSpendCents: (offer.minimum_spend_cents as number | null) ?? undefined,
				discountCents: (offer.discount_cents as number | null) ?? undefined,
				discountPercent: (offer.discount_percent as number | null) ?? undefined,
				maximumDiscountCents: (offer.maximum_discount_cents as number | null) ?? undefined,
				status: offer.status as CartSnapshot["visibleOffers"][number]["status"],
				confidence: offer.confidence as CartSnapshot["confidence"],
			});
		}
		return {
			id: row.id as string,
			createdAt: row.created_at as string,
			platform: row.platform as CartSnapshot["platform"],
			platformLabel: row.platform_label as string,
			detectionStatus: "supported",
			pageUrlOrigin: row.page_url_origin as string,
			pagePathHint: (row.page_path_hint as string | null) ?? undefined,
			cartItemCount: (row.item_count as number | null) ?? undefined,
			items: JSON.parse(await this.crypto.decrypt(row.items_json as string)),
			subtotal: money(row.subtotal_cents),
			discounts: money(row.discounts_cents),
			deliveryFee: money(row.delivery_fee_cents),
			serviceFee: money(row.service_fee_cents),
			tax: money(row.tax_cents),
			visibleCredits: money(row.visible_credits_cents),
			displayedFinalTotal: money(row.displayed_final_total_cents),
			visibleOffers,
			confidence: row.confidence as CartSnapshot["confidence"],
			extractionNotes: JSON.parse((row.extraction_notes_json as string) || "[]"),
			adapterVersion: (row.adapter_version as string | null) ?? undefined,
			privacy: { localOnly: true, piiRedacted: true, rawHtmlStored: false, cookiesRead: false },
		};
	}
}

// ----------------------------------------------------------------- plans

export class PlansRepo {
	constructor(
		private readonly db: Db,
		private readonly crypto: FieldCrypto,
	) {}

	async save(plan: PurchasePlan): Promise<void> {
		await this.db.execute(
			`INSERT OR REPLACE INTO purchase_plans (id, created_at, updated_at, status, optimization_goal, current_snapshot_id,
			 recommended_path, estimated_final_total_cents, observed_final_total_cents, plan_json, explanation_json,
			 warnings_json, confidence, policy_version, config_pack_version)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			[
				plan.id,
				plan.createdAt,
				plan.updatedAt,
				plan.status,
				plan.optimizationGoal,
				plan.sourceSnapshotId ?? null,
				plan.recommendations[0]?.headline ?? null,
				plan.estimatedPlanCost?.calculatedTotalCents ?? null,
				plan.observedCost.displayedFinalTotalCents ?? plan.observedCost.calculatedTotalCents ?? null,
				await this.crypto.encrypt(JSON.stringify(plan)),
				JSON.stringify(plan.recommendations.map((r) => r.headline)),
				JSON.stringify(plan.warnings),
				plan.confidence,
				plan.policyVersion,
				plan.configPackVersion ?? null,
			],
		);
		await this.db.execute("DELETE FROM purchase_plan_items WHERE plan_id = ?", [plan.id]);
		for (const item of [...plan.requiredItems, ...plan.optionalItems]) {
			await this.db.execute(
				`INSERT INTO purchase_plan_items (id, plan_id, shopping_item_id, display_name, required, status, notes_json)
				 VALUES (?,?,?,?,?,?,?)`,
				[
					crypto.randomUUID(),
					plan.id,
					item.shoppingItemId ?? null,
					await this.crypto.encrypt(item.displayName),
					item.required ? 1 : 0,
					item.status,
					JSON.stringify(item.notes),
				],
			);
		}
	}

	async get(id: string): Promise<PurchasePlan | undefined> {
		const rows = await this.db.query("SELECT plan_json FROM purchase_plans WHERE id = ?", [id]);
		const row = rows[0];
		if (!row) return undefined;
		return JSON.parse(await this.crypto.decrypt(row.plan_json as string));
	}

	async list(limit = 50): Promise<PurchasePlan[]> {
		const rows = await this.db.query(
			"SELECT plan_json FROM purchase_plans ORDER BY created_at DESC LIMIT ?",
			[limit],
		);
		const plans: PurchasePlan[] = [];
		for (const row of rows) {
			plans.push(JSON.parse(await this.crypto.decrypt(row.plan_json as string)));
		}
		return plans;
	}

	async updateStatus(id: string, status: PurchasePlan["status"]): Promise<void> {
		const plan = await this.get(id);
		if (!plan) return;
		const updated = { ...plan, status, updatedAt: nowIso() };
		await this.save(updated);
	}
}

// ---------------------------------------------------------------- actions

export class ActionsRepo {
	constructor(
		private readonly db: Db,
		private readonly crypto: FieldCrypto,
	) {}

	async save(action: ProposedAction): Promise<void> {
		await this.db.execute(
			`INSERT OR REPLACE INTO plan_actions (id, plan_id, action_type, proposed_payload_json, expected_page_state_hash,
			 page_origin, adapter_id, adapter_version, preconditions_json, user_visible_summary, dedupe_hash, status,
			 action_sequence, initiated_by_user, retries_used, created_at, updated_at)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,COALESCE((SELECT retries_used FROM plan_actions WHERE id=?),0),?,?)`,
			[
				action.id,
				action.planId,
				action.actionType,
				await this.crypto.encrypt(JSON.stringify(action.payload)),
				action.expectedPageStateHash ?? null,
				action.pageOrigin,
				action.adapterId,
				action.adapterVersion ?? null,
				JSON.stringify(action.preconditions),
				action.userVisibleSummary,
				action.dedupeHash,
				action.status,
				action.actionSequence,
				action.id,
				action.createdAt,
				nowIso(),
			],
		);
	}

	async get(id: string): Promise<ProposedAction | undefined> {
		const rows = await this.db.query("SELECT * FROM plan_actions WHERE id = ?", [id]);
		const row = rows[0];
		if (!row) return undefined;
		return {
			id: row.id as string,
			planId: row.plan_id as string,
			actionType: row.action_type as ProposedAction["actionType"],
			payload: JSON.parse(await this.crypto.decrypt(row.proposed_payload_json as string)),
			userVisibleSummary: row.user_visible_summary as string,
			pageOrigin: row.page_origin as string,
			expectedPageStateHash: (row.expected_page_state_hash as string | null) ?? undefined,
			adapterId: row.adapter_id as string,
			adapterVersion: (row.adapter_version as string | null) ?? undefined,
			preconditions: JSON.parse((row.preconditions_json as string) || "[]"),
			actionSequence: row.action_sequence as number,
			status: row.status as ProposedAction["status"],
			dedupeHash: row.dedupe_hash as string,
			createdAt: row.created_at as string,
		};
	}

	async listForPlan(planId: string): Promise<ProposedAction[]> {
		const rows = await this.db.query(
			"SELECT id FROM plan_actions WHERE plan_id = ? ORDER BY action_sequence ASC",
			[planId],
		);
		const actions: ProposedAction[] = [];
		for (const row of rows) {
			const action = await this.get(row.id as string);
			if (action) actions.push(action);
		}
		return actions;
	}

	async setStatus(id: string, status: ProposedAction["status"]): Promise<void> {
		await this.db.execute("UPDATE plan_actions SET status = ?, updated_at = ? WHERE id = ?", [
			status,
			nowIso(),
			id,
		]);
	}

	async executedCountForPlan(planId: string): Promise<number> {
		const rows = await this.db.query(
			`SELECT COUNT(*) AS n FROM action_results r JOIN plan_actions a ON a.id = r.action_id WHERE a.plan_id = ?`,
			[planId],
		);
		return (rows[0]?.n as number) ?? 0;
	}

	async executedDedupeHashes(planId: string): Promise<string[]> {
		const rows = await this.db.query(
			`SELECT DISTINCT a.dedupe_hash AS h FROM plan_actions a JOIN action_results r ON a.id = r.action_id
			 WHERE a.plan_id = ? AND r.outcome = 'succeeded'`,
			[planId],
		);
		return rows.map((row) => row.h as string);
	}

	async saveApproval(approval: ActionApproval): Promise<void> {
		await this.db.execute(
			`INSERT INTO action_approvals (id, action_id, approved_at, expires_at, approval_scope_hash, approved, user_visible_summary)
			 VALUES (?,?,?,?,?,?,?)`,
			[
				approval.id,
				approval.actionId,
				approval.approvedAt,
				approval.expiresAt,
				approval.approvalScopeHash,
				approval.approved ? 1 : 0,
				approval.userVisibleSummary,
			],
		);
	}

	async latestApproval(actionId: string): Promise<ActionApproval | undefined> {
		const rows = await this.db.query(
			"SELECT * FROM action_approvals WHERE action_id = ? ORDER BY approved_at DESC LIMIT 1",
			[actionId],
		);
		const row = rows[0];
		if (!row) return undefined;
		return {
			id: row.id as string,
			actionId: row.action_id as string,
			approved: (row.approved as number) === 1,
			approvedAt: row.approved_at as string,
			expiresAt: row.expires_at as string,
			approvalScopeHash: row.approval_scope_hash as string,
			userVisibleSummary: row.user_visible_summary as string,
		};
	}

	async saveResult(input: ActionResultInput): Promise<void> {
		await this.db.execute(
			`INSERT INTO action_results (id, action_id, observed_at, outcome, result_summary, post_action_snapshot_id, stop_reason, evidence_hash)
			 VALUES (?,?,?,?,?,?,?,?)`,
			[
				crypto.randomUUID(),
				input.actionId,
				nowIso(),
				input.outcome,
				input.resultSummary,
				input.postActionSnapshotId ?? null,
				input.stopReason ?? null,
				input.evidenceHash ?? null,
			],
		);
	}
}

// ----------------------------------------------------------- consent

export class ConsentRepo {
	constructor(private readonly db: Db) {}

	async active(): Promise<ConsentReceipt | undefined> {
		const rows = await this.db.query(
			"SELECT * FROM consent_receipts WHERE revoked_at IS NULL ORDER BY granted_at DESC LIMIT 1",
		);
		const row = rows[0];
		if (!row) return undefined;
		return {
			id: row.id as string,
			privacyMode: row.privacy_mode as PrivacyMode,
			consentVersion: row.consent_version as string,
			grantedAt: row.granted_at as string,
			revokedAt: (row.revoked_at as string | null) ?? undefined,
			scopeText: row.scope_text as string,
			appVersion: row.app_version as string,
			extensionVersion: (row.extension_version as string | null) ?? undefined,
		};
	}

	async grant(receipt: ConsentReceipt): Promise<void> {
		await this.db.execute(
			"UPDATE consent_receipts SET revoked_at = ? WHERE revoked_at IS NULL",
			[receipt.grantedAt],
		);
		await this.db.execute(
			`INSERT INTO consent_receipts (id, privacy_mode, consent_version, granted_at, scope_text, app_version, extension_version)
			 VALUES (?,?,?,?,?,?,?)`,
			[
				receipt.id,
				receipt.privacyMode,
				receipt.consentVersion,
				receipt.grantedAt,
				receipt.scopeText,
				receipt.appVersion,
				receipt.extensionVersion ?? null,
			],
		);
	}

	async listAll(): Promise<Record<string, unknown>[]> {
		return this.db.query("SELECT * FROM consent_receipts ORDER BY granted_at DESC");
	}
}

// ----------------------------------------------------------- sync outbox

export class OutboxRepo {
	constructor(private readonly db: Db) {}

	async queue(eventJson: string, consentReceiptId: string): Promise<number> {
		await this.db.execute(
			"INSERT INTO sync_outbox (id, created_at, event_json, consent_receipt_id, status) VALUES (?,?,?,?,'queued')",
			[crypto.randomUUID(), nowIso(), eventJson, consentReceiptId],
		);
		return this.queuedCount();
	}

	async queuedCount(): Promise<number> {
		const rows = await this.db.query("SELECT COUNT(*) AS n FROM sync_outbox WHERE status = 'queued'");
		return (rows[0]?.n as number) ?? 0;
	}

	async syncedCount(): Promise<number> {
		const rows = await this.db.query("SELECT COUNT(*) AS n FROM sync_outbox WHERE status = 'synced'");
		return (rows[0]?.n as number) ?? 0;
	}

	async lastSyncedAt(): Promise<string | undefined> {
		const rows = await this.db.query(
			"SELECT synced_at FROM sync_outbox WHERE status='synced' ORDER BY synced_at DESC LIMIT 1",
		);
		return (rows[0]?.synced_at as string | null) ?? undefined;
	}

	async takeQueued(limit = 20): Promise<Array<{ id: string; eventJson: string }>> {
		const rows = await this.db.query(
			"SELECT id, event_json FROM sync_outbox WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?",
			[limit],
		);
		return rows.map((row) => ({ id: row.id as string, eventJson: row.event_json as string }));
	}

	async markSynced(id: string, serverReceiptId: string): Promise<void> {
		await this.db.execute(
			"UPDATE sync_outbox SET status='synced', synced_at=?, server_receipt_id=? WHERE id=?",
			[nowIso(), serverReceiptId, id],
		);
	}

	async markRejected(id: string): Promise<void> {
		await this.db.execute("UPDATE sync_outbox SET status='rejected' WHERE id=?", [id]);
	}
}

// ------------------------------------------------------ configuration packs

export class ConfigPacksRepo {
	constructor(private readonly db: Db) {}

	async store(pack: ConfigurationPack, verified: boolean, active: boolean, inactiveReason?: string): Promise<void> {
		const key = `${pack.packId}@${pack.version}`;
		await this.db.execute(
			`INSERT OR REPLACE INTO configuration_packs (id, pack_id, version, issued_at, expires_at, rollout_stage, pack_json, key_id, fetched_at)
			 VALUES (?,?,?,?,?,?,?,?,?)`,
			[key, pack.packId, pack.version, pack.issuedAt, pack.expiresAt ?? null, pack.rolloutStage, JSON.stringify(pack), pack.keyId, nowIso()],
		);
		const current = await this.db.query(
			"SELECT active_version FROM configuration_pack_status WHERE pack_id = ?",
			[pack.packId],
		);
		const previous = (current[0]?.active_version as string | null) ?? null;
		await this.db.execute(
			`INSERT OR REPLACE INTO configuration_pack_status (pack_id, active_version, previous_version, verified, active, inactive_reason, updated_at)
			 VALUES (?,?,?,?,?,?,?)`,
			[
				pack.packId,
				active ? pack.version : previous,
				previous,
				verified ? 1 : 0,
				active ? 1 : 0,
				inactiveReason ?? null,
				nowIso(),
			],
		);
	}

	async deactivate(packId: string, reason: string): Promise<void> {
		await this.db.execute(
			"UPDATE configuration_pack_status SET active = 0, inactive_reason = ?, updated_at = ? WHERE pack_id = ?",
			[reason, nowIso(), packId],
		);
	}

	async rollback(packId: string): Promise<string | undefined> {
		const rows = await this.db.query(
			"SELECT previous_version FROM configuration_pack_status WHERE pack_id = ?",
			[packId],
		);
		const previous = (rows[0]?.previous_version as string | null) ?? undefined;
		if (!previous) return undefined;
		await this.db.execute(
			"UPDATE configuration_pack_status SET active_version = ?, active = 1, inactive_reason = 'rolled back', updated_at = ? WHERE pack_id = ?",
			[previous, nowIso(), packId],
		);
		return previous;
	}

	async activePack(): Promise<ConfigurationPack | undefined> {
		const status = await this.db.query(
			"SELECT pack_id, active_version FROM configuration_pack_status WHERE active = 1 LIMIT 1",
		);
		const row = status[0];
		if (!row || !row.active_version) return undefined;
		const packs = await this.db.query("SELECT pack_json FROM configuration_packs WHERE id = ?", [
			`${row.pack_id}@${row.active_version}`,
		]);
		return packs[0] ? JSON.parse(packs[0].pack_json as string) : undefined;
	}

	async summaries(): Promise<
		Array<{ packId: string; version: string; rolloutStage: string; verified: boolean; active: boolean; issuedAt: string; expiresAt?: string }>
	> {
		const rows = await this.db.query(
			`SELECT p.pack_id, p.version, p.rollout_stage, p.issued_at, p.expires_at,
			        COALESCE(s.verified, 0) AS verified,
			        CASE WHEN s.active = 1 AND s.active_version = p.version THEN 1 ELSE 0 END AS is_active
			 FROM configuration_packs p LEFT JOIN configuration_pack_status s ON s.pack_id = p.pack_id
			 ORDER BY p.fetched_at DESC`,
		);
		return rows.map((row) => ({
			packId: row.pack_id as string,
			version: row.version as string,
			rolloutStage: row.rollout_stage as string,
			verified: (row.verified as number) === 1,
			active: (row.is_active as number) === 1,
			issuedAt: row.issued_at as string,
			expiresAt: (row.expires_at as string | null) ?? undefined,
		}));
	}
}
