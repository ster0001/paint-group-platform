import { createClient } from "@/lib/supabase/server";

// Always run fresh so the check reflects the current connection.
export const dynamic = "force-dynamic";

export default async function HealthPage() {
  let ok = false;
  let message: string;

  try {
    const supabase = await createClient();
    // A tiny, harmless query: count rows in profiles without returning any data.
    // If the URL/key are valid we get a clean response (no error); if not, we get one.
    const { error } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true });

    if (error) {
      message = error.message;
    } else {
      ok = true;
      message = "Your app is talking to Supabase.";
    }
  } catch (e) {
    message = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      <div
        className={`text-2xl font-semibold ${ok ? "text-green-600" : "text-red-600"}`}
      >
        {ok ? "✅ Database connected" : "❌ Not connected"}
      </div>
      <p className="mt-3 max-w-md text-sm text-gray-500">{message}</p>
    </main>
  );
}
