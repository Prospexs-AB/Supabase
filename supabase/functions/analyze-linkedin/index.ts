// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";

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

function getWords(str: string) {
  return str
    .toLowerCase()
    .replace(/(inc|llc|ltd|corp|co|\.|,)/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function hasOverlap(a: string, b: string) {
  const aWords = new Set(getWords(a));
  const bWords = new Set(getWords(b));
  for (const word of aWords) {
    if (bWords.has(word) && word.length > 2) {
      // ignore very short words
      return true;
    }
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const userId = await getUserId(req, supabase);

    const body = await req.json();

    const { campaign_id, linkedin_url } = body;

    if (!campaign_id) {
      return new Response(
        JSON.stringify({ error: "campaign_id is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    if (!linkedin_url) {
      return new Response(
        JSON.stringify({ error: "linkedin_url is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const { data: campaignData, error: campaignError } = await supabase
      .from("campaigns")
      .select("*")
      .eq("user_id", userId)
      .eq("id", campaign_id)
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

    const proxycurlApiKey = Deno.env.get("Proxycurl_API");

    if (!proxycurlApiKey) {
      return new Response(
        JSON.stringify({ error: "Proxycurl API key is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log("Proxycurl API key found:", proxycurlApiKey ? "Yes" : "No");
    console.log("API key length:", proxycurlApiKey?.length || 0);

    const url = new URL("https://enrichlayer.com/api/v2/profile");
    url.searchParams.set("url", linkedin_url);
    url.searchParams.set("use_cache", "if-present");

    console.log("Making request to:", url.toString());

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${proxycurlApiKey}`,
      },
    });

    console.log("Response status:", response.status);
    console.log(
      "Response headers:",
      Object.fromEntries(response.headers.entries())
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Proxycurl API error:", errorText);
      return new Response(
        JSON.stringify({
          error: `Person profile does not exist or has been deleted or marked as private by the user`,
          details: errorText.substring(0, 500), // Limit error details
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const responseText = await response.text();
      console.error("Unexpected response type:", contentType);
      console.error("Response body:", responseText.substring(0, 500));
      return new Response(
        JSON.stringify({
          error: "Proxycurl API returned non-JSON response",
          contentType: contentType,
          details: responseText.substring(0, 500),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const data = await response.json();
    console.log("data", data);

    const {
      step_2_result: { company_name },
    } = progressData;

    // if (
    //   !company_name ||
    //   !data.occupation ||
    //   (!(
    //     hasOverlap(company_name, data.occupation) ||
    //     hasOverlap(data.occupation, company_name)
    //   ) &&
    //     !(
    //       hasOverlap(company_name, data.headline) ||
    //       hasOverlap(data.headline, company_name)
    //     ))
    // ) {
    //   return new Response(
    //     JSON.stringify({
    //       error: "User is not working in the same company as the campaign",
    //     }),
    //     {
    //       headers: { ...corsHeaders, "Content-Type": "application/json" },
    //       status: 400,
    //     }
    //   );
    // }

    const new_latest_step = 5;
    const cleanFurtherProgress = {};
    for (let x = new_latest_step + 1; x <= 10; x++) {
      const keyName = `step_${x}_result`;
      cleanFurtherProgress[keyName] = null;
    }

    const { error: progressUpdateError } = await supabase
      .from("campaign_progress")
      .update({
        latest_step: new_latest_step,
        step_5_result: {
          linkedin_url: linkedin_url,
          linkedin_profile: data,
        },
        ...cleanFurtherProgress,
      })
      .eq("id", campaignData.progress_id);

    if (progressUpdateError) {
      return new Response(
        JSON.stringify({ error: progressUpdateError.message }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    return new Response(
      JSON.stringify({
        message: "Linkedin profile analyzed successfully",
        data: data,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status:
        error.message.includes("Authorization") ||
        error.message.includes("Invalid")
          ? 401
          : 500,
    });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

    curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/analyze-linkedin' \
    --header 'Authorization: Bearer YOUR_JWT_TOKEN' \
    --header 'Content-Type: application/json' \
    --data '{"campaign_id":"123", "linkedin_url": "https://www.linkedin.com/in/john-doe-1234567890/"}'

*/
