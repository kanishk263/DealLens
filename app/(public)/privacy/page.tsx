export const metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 text-sm leading-6 text-ink">
      <h1 className="text-2xl font-semibold">Privacy notice (placeholder)</h1>
      <p className="mt-3 text-muted">This placeholder must be replaced with a reviewed privacy notice before DealLens processes real personal or client data.</p>
      <h2 className="mt-6 font-semibold">What the application stores</h2>
      <ul className="mt-2 list-disc pl-5 text-muted">
        <li>Your Google account name, email address and avatar URL, as provided through Google sign-in.</li>
        <li>Sign-in timestamps and an audit trail of actions you take in the application.</li>
        <li>Financial documents and derived data submitted by your organisation, stored in private storage.</li>
      </ul>
      <p className="mt-4 text-muted">DealLens does not receive or store your Google password. No compliance certification is claimed.</p>
    </div>
  );
}
