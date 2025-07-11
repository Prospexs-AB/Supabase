// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

const getUserId = async (req: Request, supabase: SupabaseClient) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new Error("Authorization header is required");
  }
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    throw new Error("Invalid or expired token");
  }

  return user.id;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders,
    });
  }

  const method = req.method.toUpperCase();
  const supabase = createClient(
    "https://lkkwcjhlkxqttcqrcfpm.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxra3djamhsa3hxdHRjcXJjZnBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTMxMzE5OCwiZXhwIjoyMDYwODg5MTk4fQ.e8SijEhKnoa1R8dYzPBeKcgsEjKtXb9_Gd1uYg6AhuA"
  );
  const userId = await getUserId(req, supabase);

  switch (method) {
    case "GET":
      const url = new URL(req.url);
      const campaignId = url.searchParams.get("campaign_id");

      if (!campaignId) {
        try {
          const { data, error } = await supabase
            .from("campaigns")
            .select("*")
            .eq("user_id", userId);

          if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            });
          }

          return new Response(JSON.stringify({ data }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        } catch (dbError) {
          console.error("Database error:", dbError);
          return new Response(
            JSON.stringify({ error: "Failed to fetch company details" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }
      } else {
        try {
          const { data, error } = await supabase
            .from("campaigns")
            .select(
              `
              id,
              created_at,
              language,
              company_name,
              company_website,
              campaign_progress (
                id,
                latest_step,
                status,
                created_at
              )
            `
            )
            .eq("user_id", userId)
            .eq("id", campaignId)
            .single();

          if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            });
          }

          return new Response(JSON.stringify({ data }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        } catch (dbError) {
          console.error("Database error:", dbError);
          return new Response(
            JSON.stringify({ error: "Failed to fetch campaign details" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }
      }

    case "POST":
      try {
        const { data: campaignProgressData, error: campaignProgressError } =
          await supabase
            .from("campaign_progress")
            .insert({
              latest_step: 0,
              status: "in_progress",
            })
            .select()
            .single();

        if (campaignProgressError) {
          return new Response(
            JSON.stringify({ error: campaignProgressError.message }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }

        const campaignProgressId = campaignProgressData.id;

        const { data: campaignData, error: campaignError } = await supabase
          .from("campaigns")
          .insert({
            user_id: userId,
            progress_id: campaignProgressId,
          })
          .select()
          .single();

        if (campaignError) {
          return new Response(
            JSON.stringify({ error: campaignError.message }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }

        return new Response(
          JSON.stringify({
            message: "Campaign created successfully",
            campaignData,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (dbError) {
        console.error("Database error:", dbError);
        return new Response(
          JSON.stringify({ error: "Failed to create campaign" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }
    default:
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    --data '{"company_name":"Functions","company_website":"https://functions.com"}'

*/
