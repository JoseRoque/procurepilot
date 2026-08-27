const FOOTER_LINKS = [
	{ href: "#product", label: "Product" },
	{ href: "#privacy", label: "Privacy" },
	{ href: "#early-access", label: "Contact" },
	{ href: "#early-access", label: "Early access" },
];

export function ProcurementFooter() {
	return (
		<footer className="border-t border-slate-200 bg-white">
			<div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
				<div>
					<p className="text-sm font-semibold text-slate-900">
						Purchasing Intelligence
					</p>
					<p className="mt-1 text-sm text-slate-500">
						Purchasing intelligence for better business buying.
					</p>
				</div>
				<nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
					{FOOTER_LINKS.map((link) => (
						<a
							key={link.label}
							href={link.href}
							className="text-sm text-slate-600 hover:text-slate-900"
						>
							{link.label}
						</a>
					))}
				</nav>
			</div>
		</footer>
	);
}
