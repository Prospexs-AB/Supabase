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
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const supabase = createClient(
    "https://lkkwcjhlkxqttcqrcfpm.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxra3djamhsa3hxdHRjcXJjZnBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTMxMzE5OCwiZXhwIjoyMDYwODg5MTk4fQ.e8SijEhKnoa1R8dYzPBeKcgsEjKtXb9_Gd1uYg6AhuA"
  );

  const userId = await getUserId(req, supabase);
  const { campaign_id, target_audiences } = await req.json();

  const { data: campaignData, error: campaignError } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaign_id)
    .eq("user_id", userId)
    .single();

  if (campaignError) {
    return new Response(JSON.stringify({ error: campaignError.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  const { data: progressData, error: progressError } = await supabase
    .from("campaign_progress")
    .select("*")
    .eq("id", campaignData.progress_id)
    .single();

  if (progressError) {
    return new Response(JSON.stringify({ error: progressError.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  const {
    step_4_result: { user_role },
  } = progressData;

  const generectApiKey = "9923f958608bb3dd9e446506c6213706b46de708";
  const generectUrl = "https://api.generect.com/api/linkedin/leads/by_icp/";
  const generectHeaders = {
    "Content-Type": "application/json",
    Authorization: `Token ${generectApiKey}`,
  };

  const leadsData = [];
  for (const targetAudience of target_audiences) {
    const generectBody = {
      without_company: true,
      locations: [targetAudience.country],
      personas: [
        [targetAudience.role, [targetAudience.industry], [], [user_role]],
      ],
      limit_by: 100,
    };

    const generectResponse = await fetch(generectUrl, {
      method: "POST",
      headers: generectHeaders,
      body: JSON.stringify(generectBody),
    });

    const generectData = await generectResponse.json();
    leadsData.push({
      role: targetAudience.role,
      industry: targetAudience.industry,
      leads: generectData?.leads,
    });
  }

  const new_latest_step = 8;
  const cleanFurtherProgress = {};
  for (let x = new_latest_step + 1; x <= 9; x++) {
    const keyName = `step_${x}_result`;
    cleanFurtherProgress[keyName] = null;
  }

  const { error: updateError } = await supabase
    .from("campaign_progress")
    .update({
      latest_step: new_latest_step,
      step_8_result: leadsData,
      ...cleanFurtherProgress,
    })
    .eq("id", campaignData.progress_id);

  if (updateError) {
    console.error("Error updating campaign progress:", updateError);
    return new Response(JSON.stringify({ error: updateError.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  return new Response(
    JSON.stringify({
      message: "Campaign leads processed",
      data: {
        leads: leadsData,
        filters: [],
      },
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    }
  );
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/campaign-leads' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
