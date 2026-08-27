import { describe, expect, it } from "vitest";
import {
	containsSensitiveText,
	hasSensitiveInputFields,
	isSensitivePage,
	isSensitiveUrl,
} from "./sensitivePages";

describe("isSensitiveUrl", () => {
	it("flags common login/auth paths", () => {
		expect(isSensitiveUrl(new URL("https://shop.example.com/login"))).toBe(true);
		expect(isSensitiveUrl(new URL("https://shop.example.com/account/sign-in"))).toBe(true);
		expect(isSensitiveUrl(new URL("https://shop.example.com/password/reset"))).toBe(true);
	});

	it("flags payment/billing paths", () => {
		expect(isSensitiveUrl(new URL("https://shop.example.com/checkout/payment"))).toBe(true);
		expect(isSensitiveUrl(new URL("https://shop.example.com/account/billing"))).toBe(true);
	});

	it("flags MFA/OTP paths", () => {
		expect(isSensitiveUrl(new URL("https://shop.example.com/verify/otp"))).toBe(true);
		expect(isSensitiveUrl(new URL("https://shop.example.com/mfa/challenge"))).toBe(true);
	});

	it("does not flag an ordinary cart page", () => {
		expect(isSensitiveUrl(new URL("https://shop.example.com/cart"))).toBe(false);
	});
});

describe("containsSensitiveText", () => {
	it("flags one-time-code and verification wording", () => {
		expect(containsSensitiveText("Enter your one-time passcode")).toBe(true);
		expect(containsSensitiveText("Verification code sent to your phone")).toBe(true);
	});

	it("flags card-entry wording", () => {
		expect(containsSensitiveText("Card number")).toBe(true);
		expect(containsSensitiveText("CVV")).toBe(true);
	});

	it("does not flag ordinary cart copy", () => {
		expect(containsSensitiveText("Your cart subtotal is $31.42")).toBe(false);
	});
});

describe("isSensitivePage", () => {
	it("is sensitive if either the URL or the text matches", () => {
		expect(isSensitivePage(new URL("https://shop.example.com/cart"), "Enter your password")).toBe(true);
		expect(isSensitivePage(new URL("https://shop.example.com/login"), "")).toBe(true);
		expect(isSensitivePage(new URL("https://shop.example.com/cart"), "Subtotal $10.00")).toBe(false);
	});
});

describe("hasSensitiveInputFields", () => {
	it("detects a password input", () => {
		document.body.innerHTML = '<input type="password" />';
		expect(hasSensitiveInputFields(document)).toBe(true);
	});

	it("detects a one-time-code autocomplete input", () => {
		document.body.innerHTML = '<input autocomplete="one-time-code" />';
		expect(hasSensitiveInputFields(document)).toBe(true);
	});

	it("returns false for an ordinary cart page", () => {
		document.body.innerHTML = '<input type="text" name="quantity" />';
		expect(hasSensitiveInputFields(document)).toBe(false);
	});
});
