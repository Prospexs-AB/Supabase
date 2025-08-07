// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "npm:openai";

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

// Helper function to clean JSON responses from OpenAI
const cleanJsonResponse = (response: string): string => {
  let cleaned = response.trim();
  
  // Handle cases where there's text before the JSON
  const jsonMatch = cleaned.match(/```(?:json)?\s*(\[[\s\S]*?\]|\{[\s\S]*?\})\s*```/);
  if (jsonMatch) {
    return jsonMatch[1];
  } else if (cleaned.startsWith("```json")) {
    return cleaned
      .replace(/^```json\s*/, "")
      .replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    return cleaned
      .replace(/^```\s*/, "")
      .replace(/\s*```$/, "");
  }
  
  return cleaned;
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabase = createClient(
      "https://lkkwcjhlkxqttcqrcfpm.supabase.co",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxra3djamhsa3hxdHRjcXJjZnBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTMxMzE5OCwiZXhwIjoyMDYwODg5MTk4fQ.e8SijEhKnoa1R8dYzPBeKcgsEjKtXb9_Gd1uYg6AhuA"
    );

    const userId = await getUserId(req, supabase);
    const { campaign_id, lead } = await req.json();

    console.log(`=============== Start for: ${campaign_id} ===============`);

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

    let {
      step_10_result,
      step_1_result: { language },
    } = progressData;
    if (!step_10_result) {
      step_10_result = [];
    }

    const leadExists = step_10_result.find(
      (savedLead) => savedLead.full_name === lead.full_name
    );

    if (leadExists) {
      return new Response(JSON.stringify(leadExists), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const { data: jobData, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("campaign_id", campaign_id);

    const jobExists = jobData.find(
      (job) => job.progress_data.full_name === lead.full_name
    );
    console.log("jobExists", jobExists);

    if (jobExists) {
      return new Response(
        JSON.stringify({
          message: `Job already exists for ${lead.full_name}`,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    const { company_name: lead_company_name } = lead;

    console.log("===== Getting details with challenges =====");

    const challengesPrompt = `
      What is the most recent publicly available annual revenue of ${lead_company_name}, in USD?
      If exact revenue is not available, provide a credible estimate based on available data (e.g.
      funding size, employee count, ARR benchmarks, analyst estimates, or reported growth metrics).
      Specify:
      - The source of the information (e.g. company report, Crunchbase, press article)
      - The fiscal year or date the revenue figure applies to
      If no reliable revenue estimate is available, clearly say “Unknown.”

      What is the most recent publicly available number of employees at ${lead_company_name}?
      If the exact number is not available, provide a credible estimate based on public data (e.g.
      LinkedIn, company website, funding size, growth stage, or press coverage).
      If no reliable estimate is available, clearly say “Unknown.”

      What is the primary industry of ${lead_company_name}?
      Return the answer as a single word, such as:
      “Software”, “Retail”, “Construction”, “Logistics”, “Healthcare”, etc.
      Use the company's core business model or primary source of revenue to determine the correct
      industry.
      If the company spans multiple verticals, choose the dominant one based on product focus or
      market positioning.
      Do not include any explanations—just return the one-word industry.

      You are a senior industry analyst and enterprise consultant.
      Your task: For ${lead_company_name}, identify 4 key challenges they are facing in their market,
      describe how ${campaignData.company_name} addresses these challenges.

      Describe the specific operational, financial, or strategic challenge ${lead_company_name} is
      facing.
      ● Use public, verifiable sources:
        ○ Annual reports & investor filings (10-Ks, earnings calls).
        ○ Industry research (Gartner, McKinsey, PwC, BCG, IDC).
        ○ Credible news outlets (Reuters, WSJ, Financial Times).
        ○ Regulatory reports & benchmarks (e.g., EU labor data, SEC filings).
      ● Include 3-5 data points (e.g., “turnover rates at 35%,” “revenue declined by 5% YoY,”
      “average compliance fine €150,000”).
      ● Localize the context if relevant (country/region).
      ● 150-200 words each.

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT: You must return ONLY valid JSON in the exact format specified below. Do not include any explanatory text, markdown formatting, or additional content outside the JSON structure.
      Return the answers in the following JSON format:
      {
        "company_name": "Acme Inc.",
        "revenue": "USD $1,000,000",
        "employees": "100",
        "industry": "Software",
        "challenges": [
          {
            "title": "the title of the challenge will be here",
            "description": "Description of challenge 1",
            "source": [ "Source 1", "Source 2" ]
          },
        ]
      }
    `;

    const detailsWithChallengesOutput = await openai.responses.create({
      model: "gpt-4.1",
      tools: [{ type: "web_search_preview" }],
      input: challengesPrompt,
    });

    const cleanDetailsWithChallengesOutput = cleanJsonResponse(
      detailsWithChallengesOutput.output_text
    );

    const parsedDetailsWithChallengesOutput = JSON.parse(
      cleanDetailsWithChallengesOutput
    );

    const result = {
      businessInsights: {
        detail: {
          company_name: parsedDetailsWithChallengesOutput.company_name,
          revenue: parsedDetailsWithChallengesOutput.revenue,
          employees: parsedDetailsWithChallengesOutput.employees,
          industry: parsedDetailsWithChallengesOutput.industry,
        },
        challengesWithSolutions: parsedDetailsWithChallengesOutput.challenges,
      },
      personInsights: {},
    };

    await supabase.from("jobs").insert({
      campaign_id: campaign_id,
      job_name: "lead-insights",
      job_step: 1,
      status: "queued",
      progress_data: { ...lead, insights: result },
    });

    console.log(`Adding job to database:`, lead.full_name);

    return new Response(
      JSON.stringify({
        message: "Successfully generated business insights",
        data: { ...lead, insights: result },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/lead-insights' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
