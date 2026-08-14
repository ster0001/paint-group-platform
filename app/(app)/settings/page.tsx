export default function SettingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <div className="mt-4 max-w-xl rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Company details</h2>
        <p className="mt-1 text-sm text-gray-500">
          These will populate the header of every estimate (logo, company &amp; banking
          details, estimator, and the auto-generated estimate ID). Editing lands here next.
        </p>
        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-gray-500">Company</dt><dd>Paint Group</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">ABN</dt><dd>41 639 780 108</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">Estimator</dt><dd>Tom Roman</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">Email</dt><dd>info@paintgroup.com.au</dd></div>
        </dl>
      </div>
    </div>
  );
}
