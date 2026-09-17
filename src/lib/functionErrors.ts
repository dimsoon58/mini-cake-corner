// supabase-js's functions.invoke() only ever puts a generic "Edge Function
// returned a non-2xx status code" in error.message on failure — the real
// reason (Invalid PIN, Admin sign-in required, Invalid or unknown action
// token, ...) is the JSON body the function actually sent back, exposed on
// a FunctionsHttpError as error.context (the raw Response object). Read
// that first; fall back to the generic message only if it's missing or
// unparsable.
export async function extractFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  try {
    const context = (error as { context?: Response })?.context;
    if (context && typeof context.json === "function") {
      const body = await context.json();
      if (body && typeof body.error === "string" && body.error) return body.error;
    }
  } catch {
    // Body wasn't JSON, or already consumed — fall through to the generic message.
  }
  return (error as { message?: string })?.message || fallback;
}
