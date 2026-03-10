import { createClient } from "@supabase/supabase-js";

try {
  console.log("Testing createClient with empty URL...");
  const supabase = createClient("", "");
  console.log("Success (unexpected)");
} catch (err: any) {
  console.log("Caught error:", err.message);
}
