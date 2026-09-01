import { login, signup } from "@/app/auth/actions";
import { requestLinkAction } from "@/app/account/login/actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          Paint Group Platform
        </h1>
        <p className="mt-1 text-center text-sm text-gray-500">
          Sign in, or create an account.
        </p>

        {error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <form className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium" htmlFor="name">
              Name{" "}
              <span className="font-normal text-gray-400">
                (only needed to create an account)
              </span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Jane Painter"
            />
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="At least 6 characters"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              formAction={login}
              className="flex-1 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
            >
              Sign in
            </button>
            <button
              formAction={signup}
              className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Create account
            </button>
          </div>

          {/* Tom, 1 Sep: customers lost their way into the portal when the
              estimate page's email box went (27 Aug batch) — the magic link
              lives HERE now too. Same server action as /account/login (one
              implementation, never a fork); formNoValidate so the password
              field's `required` can't block a passwordless sign-in. */}
          <div className="relative pt-2">
            <div className="absolute inset-x-0 top-1/2 border-t border-gray-200" />
            <p className="relative mx-auto w-fit bg-white px-3 text-center text-xs uppercase tracking-wide text-gray-400">
              or
            </p>
          </div>
          <button
            formAction={requestLinkAction}
            formNoValidate
            className="w-full rounded-md border border-cyan-600 px-4 py-2 text-sm font-medium text-cyan-700 hover:bg-cyan-50"
          >
            ✉️ Email me a sign-in link — no password
          </button>
          <p className="!mt-2 text-center text-xs text-gray-500">
            For customers: type your email above, tap the button, and the link
            in your inbox opens your customer portal.
          </p>
        </form>
      </div>
    </main>
  );
}
