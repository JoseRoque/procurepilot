import { useState } from "react";
import { CtaButton } from "~/components/procurement/CtaButton";

const NAV_LINKS = [
	{ href: "#product", label: "Product" },
	{ href: "#how-it-works", label: "How it works" },
	{ href: "#privacy", label: "Privacy" },
	{ href: "#faq", label: "FAQ" },
];

export function ProcurementNav() {
	const [isMenuOpen, setIsMenuOpen] = useState(false);

	return (
		<header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
			<nav
				aria-label="Primary"
				className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8"
			>
				<a
					href="#top"
					className="text-base font-semibold tracking-tight text-slate-900"
				>
					Purchasing Intelligence
				</a>

				<div className="hidden items-center gap-8 md:flex">
					{NAV_LINKS.map((link) => (
						<a
							key={link.href}
							href={link.href}
							className="text-sm font-medium text-slate-600 hover:text-slate-900"
						>
							{link.label}
						</a>
					))}
					<CtaButton as="a" href="#early-access" size="md">
						Request early access
					</CtaButton>
				</div>

				<button
					type="button"
					className="inline-flex items-center justify-center rounded-md p-2 text-slate-700 hover:bg-slate-100 md:hidden"
					aria-expanded={isMenuOpen}
					aria-controls="procurement-mobile-menu"
					onClick={() => setIsMenuOpen((open) => !open)}
				>
					<span className="sr-only">
						{isMenuOpen ? "Close menu" : "Open menu"}
					</span>
					{isMenuOpen ? (
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth={2}
							className="h-6 w-6"
							aria-hidden="true"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M6 18 18 6M6 6l12 12"
							/>
						</svg>
					) : (
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth={2}
							className="h-6 w-6"
							aria-hidden="true"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"
							/>
						</svg>
					)}
				</button>
			</nav>

			{isMenuOpen ? (
				<div
					id="procurement-mobile-menu"
					className="border-t border-slate-200 bg-white px-4 pb-6 pt-2 md:hidden"
				>
					<div className="flex flex-col gap-1">
						{NAV_LINKS.map((link) => (
							<a
								key={link.href}
								href={link.href}
								onClick={() => setIsMenuOpen(false)}
								className="rounded-md px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
							>
								{link.label}
							</a>
						))}
					</div>
					<CtaButton
						as="a"
						href="#early-access"
						size="md"
						className="mt-3 w-full"
						onClick={() => setIsMenuOpen(false)}
					>
						Request early access
					</CtaButton>
				</div>
			) : null}
		</header>
	);
}
