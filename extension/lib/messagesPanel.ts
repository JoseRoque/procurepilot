import { z } from "zod";
import type { ActionType } from "../../packages/domain/src";
import type { ActionSelectorMap } from "./actions/executor";
import type { DetectionStatus, SupportedPlatform } from "./types";

/**
 * Side panel ⇄ content script protocol (chrome.tabs.sendMessage). The panel
 * is the only sender; the content script validates every message and never
 * acts on anything else. EXECUTE_ACTION additionally re-checks the sensitive
 * -page heuristics, origin, and page-state hash before touching anything.
 */

const ACTION_TYPES = [
	"scan_page",
	"open_visible_offers",
	"search_exact_item",
	"add_exact_approved_item",
	"adjust_quantity",
	"remove_optional_item",
	"rescan_cart",
] as const;

const boundedSelectorSchema = z.object({
	css: z.string().min(1).max(200),
	maxMatches: z.number().int().min(1).max(5),
	requiresVisibleText: z.string().max(100).optional(),
});

const panelMessageSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("GET_PAGE_STATE") }),
	z.object({
		type: z.literal("EXECUTE_ACTION"),
		payload: z.object({
			actionId: z.string().min(1).max(64),
			actionType: z.enum(ACTION_TYPES),
			actionPayload: z.record(z.string(), z.unknown()),
			expectedPageOrigin: z.string().max(200),
			expectedPageStateHash: z.string().max(128).optional(),
			selectors: z.record(z.string(), boundedSelectorSchema),
		}),
	}),
]);

export type PanelToContentMessage =
	| { type: "GET_PAGE_STATE" }
	| {
			type: "EXECUTE_ACTION";
			payload: {
				actionId: string;
				actionType: ActionType;
				actionPayload: Record<string, unknown>;
				expectedPageOrigin: string;
				expectedPageStateHash?: string;
				selectors: ActionSelectorMap;
			};
	  };

export type PageStateResponse = {
	type: "PAGE_STATE";
	payload: {
		pageOrigin: string;
		pagePathHint: string;
		pageStateHash: string;
		sensitivePage: boolean;
		platform: SupportedPlatform;
		detectionStatus: DetectionStatus;
	};
};

export type ExecuteActionResponse = {
	type: "EXECUTE_RESULT";
	payload: {
		actionId: string;
		outcome: "succeeded" | "failed" | "preconditions_failed" | "stopped_for_review";
		summary: string;
		stopReason?: string;
		postActionPageStateHash?: string;
	};
};

export type ContentToPanelResponse = PageStateResponse | ExecuteActionResponse;

export function parsePanelMessage(value: unknown): PanelToContentMessage | undefined {
	const result = panelMessageSchema.safeParse(value);
	return result.success ? (result.data as PanelToContentMessage) : undefined;
}
