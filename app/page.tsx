import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Paint Group Platform
      </h1>
      <p className="mt-3 text-base text-gray-500">
        It&apos;s working. This is your starting point.
      </p>
      <Link
        href="/login"
        className="mt-6 rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
      >
        Sign in / Create account
      </Link>
    </main>
  );
}
