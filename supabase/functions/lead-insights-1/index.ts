// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "npm:openai";
import { z } from "npm:zod@3.25.76";
import { zodTextFormat } from "npm:openai/helpers/zod";
import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

// Helper function to clean JSON responses from OpenAI
const cleanJsonResponse = (response: string): string => {
  let cleaned = response.trim();

  // Handle cases where there's text before the JSON
  const jsonMatch = cleaned.match(
    /```(?:json)?\s*(\[[\s\S]*?\]|\{[\s\S]*?\})\s*```/
  );
  if (jsonMatch) {
    return jsonMatch[1];
  } else if (cleaned.startsWith("```json")) {
    return cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    return cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: jobDataList } = await supabase
      .from("jobs")
      .select("*")
      .eq("job_name", "lead-insights")
      .eq("status", "processing")
      .eq("job_step", 0)
      .limit(3);

    if ((jobDataList || []).length === 3) {
      console.log("Too many jobs running");
      return new Response(JSON.stringify({ error: "Too many jobs" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 429,
      });
    }

    const { data: jobData, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("job_name", "lead-insights")
      .eq("status", "queued")
      .eq("job_step", 0)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (jobError) {
      console.log("Error getting job:", jobError);
      return new Response(JSON.stringify({ error: jobError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    if (!jobData) {
      console.log("No job found");
      return new Response(null, {
        headers: { ...corsHeaders },
        status: 204,
      });
    }

    console.log("Job ID: ", jobData.id);

    // Atomically claim the job by guarding on current status
    const { data: claimedJob, error: claimError } = await supabase
      .from("jobs")
      .update({ status: "processing" })
      .eq("id", jobData.id)
      .eq("status", "queued")
      .select()
      .single();

    if (claimError || !claimedJob) {
      console.log(`Failed to claim job ${jobData.id}:`, claimError);
      return new Response(
        JSON.stringify({ error: "Job already claimed by another worker" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 409,
        }
      );
    }

    const { campaign_id, progress_data: lead } = jobData;

    console.log(`=============== Start for: ${campaign_id} ===============`);

    const { data: campaignData, error: campaignError } = await supabase
      .from("campaigns")
      .select("*")
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

    let {
      step_1_result: { language },
    } = progressData;

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
      ● Use external sources to support the data if not available then use the company's own data but always add the sources.
      ● Only keep the source urls and not the name of the source.

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

    console.log("prompt", challengesPrompt);
    console.log("model", "gpt-4.1");
    console.log("approach", "openai.responses.create");
    console.log("tools", [{ type: "web_search_preview" }]);

    const analysisSchema = z.object({
      detailsWithChallengesOutput: z.object({
        company_name: z.string(),
        revenue: z.string(),
        employees: z.string(),
        industry: z.string(),
        challenges: z.array(
          z.object({
            title: z.string(),
            description: z.string(),
            source: z.array(z.string()),
          })
        ),
      }),
    });

    let detailsWithChallengesOutput;
    try {
      console.log("Sending request to OpenAI API...");
      const openAiResponse = await openai.responses.parse({
        model: "gpt-4.1",
        tools: [{ type: "web_search_preview" }],
        input: [{ role: "user", content: challengesPrompt }],
        max_output_tokens: 4096,
        text: {
          format: zodTextFormat(analysisSchema, "detailsWithChallengesOutput"),
        },
      });
      detailsWithChallengesOutput =
        openAiResponse.output_parsed.detailsWithChallengesOutput;
      console.log("OpenAI response:", detailsWithChallengesOutput);
    } catch (error) {
      console.log("Error OpenAI:", error);
      console.log("Sending request to Anthropic API...");
      const client = new Anthropic({
        apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
      });
      const anthropicResponse = await client.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 4096,
        system: `You are an assistant that will follow the user's instructions and not return any extra info or markdown formatting. You will not return any markdown and will only return the target audience in a JSON format array of target audience objects without any other text. You will ensure that the JSON response is a valid JSON format and in the language of the user's requested language code: ${language}.`,
        messages: [{ role: "user", content: challengesPrompt }],
      });
      console.log("Anthropic response:", anthropicResponse.content[0].text);
      let cleanResponse = anthropicResponse.content[0].text.trim();
      const cleanedResponse = cleanJsonResponse(cleanResponse);
      const parsedResponse = JSON.parse(cleanedResponse);
      detailsWithChallengesOutput = parsedResponse;
      console.log("Anthropic response:", parsedResponse);
    }

    // const { detailsWithChallengesOutput } = openAiResponse.output_parsed;

    // console.log("detailsWithChallengesOutput", detailsWithChallengesOutput);

    // const cleanDetailsWithChallengesOutput = cleanJsonResponse(
    //   detailsWithChallengesOutput.output_text
    // );

    // const parsedDetailsWithChallengesOutput = JSON.parse(
    //   cleanDetailsWithChallengesOutput
    // );

    const result = {
      businessInsights: {
        detail: {
          company_name: detailsWithChallengesOutput.company_name,
          revenue: detailsWithChallengesOutput.revenue,
          employees: detailsWithChallengesOutput.employees,
          industry: detailsWithChallengesOutput.industry,
        },
        challengesWithSolutions: detailsWithChallengesOutput.challenges,
      },
      personInsights: {},
    };

    const { error: updateJobError } = await supabase
      .from("jobs")
      .update({
        job_step: 1,
        progress_data: { ...lead, insights: result },
        status: "waiting_for_next_step",
        retries: null,
      })
      .eq("id", jobData.id);

    if (updateJobError) {
      console.error(`Error updating job ${jobData.id}:`, updateJobError);
      return new Response(JSON.stringify({ error: updateJobError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    console.log(`Adding job to database:`, lead.full_name);

    return new Response(
      JSON.stringify({
        message: "Successfully generated insights",
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

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/lead-insights-1' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
