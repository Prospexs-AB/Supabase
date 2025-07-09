// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const method = req.method.toUpperCase();
  const supabase = createClient(
    "https://lkkwcjhlkxqttcqrcfpm.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxra3djamhsa3hxdHRjcXJjZnBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTMxMzE5OCwiZXhwIjoyMDYwODg5MTk4fQ.e8SijEhKnoa1R8dYzPBeKcgsEjKtXb9_Gd1uYg6AhuA"
  );

  switch (method) {
    case "GET":
      const url = new URL(req.url);
      const userId = url.searchParams.get("user_id");

      if (!userId) {
        return new Response(
          JSON.stringify({ error: "user_id parameter is required" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 400,
          }
        );
      }

      try {
        const { data, error } = await supabase
          .from("campaigns")
          .select("*")
          .eq("user_id", userId);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            headers: { "Content-Type": "application/json" },
            status: 500,
          });
        }

        return new Response(JSON.stringify({ data }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      } catch (dbError) {
        console.error("Database error:", dbError);
        return new Response(
          JSON.stringify({ error: "Failed to fetch company details" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 500,
          }
        );
      }

    case "POST":
      const body = await req.json();
      const { user_id } = body;

      if (!user_id) {
        return new Response(JSON.stringify({ error: "user_id is required" }), {
          headers: { "Content-Type": "application/json" },
          status: 400,
        });
      }

      try {
        const { data, error } = await supabase
          .from("campaigns")
          .insert({
            user_id,
          })
          .select()
          .single();

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            headers: { "Content-Type": "application/json" },
            status: 500,
          });
        }

        return new Response(
          JSON.stringify({
            message: "Campaign created successfully",
            data,
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (dbError) {
        console.error("Database error:", dbError);
        return new Response(
          JSON.stringify({ error: "Failed to create campaign" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 500,
          }
        );
      }
    default:
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        headers: { "Content-Type": "application/json" },
        status: 405,
      });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/campaigns' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
