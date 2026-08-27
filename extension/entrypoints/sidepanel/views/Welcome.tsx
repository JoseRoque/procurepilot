import { Section } from "../components/Section";

export function Welcome({ onDismiss }: { onDismiss: () => void }) {
	return (
		<Section title="Welcome">
			<p className="text-sm leading-6 text-slate-700">
				Purchasing Intelligence reads visible cart and offer details only when you ask it to scan.
				It never reads payment data, passwords, or merchant cookies.
			</p>
			<ul className="mt-3 space-y-1.5 text-sm text-slate-600">
				<li>• All captured data stays on this device by default.</li>
				<li>• Scanning only happens when you click a scan button.</li>
				<li>• Cloud sync is disabled in this version.</li>
			</ul>
			<button
				type="button"
				onClick={onDismiss}
				className="mt-4 w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
			>
				Got it
			</button>
		</Section>
	);
}
