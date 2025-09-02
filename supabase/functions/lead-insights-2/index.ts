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

    const { data: jobData, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("job_name", "lead-insights")
      .eq("status", "waiting_for_next_step")
      .eq("job_step", 1)
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

    console.log(
      `===== Starting job processing for job id: ${jobData.id} =====`
    );

    const { data: claimedJob, error: claimError } = await supabase
      .from("jobs")
      .update({ status: "processing" })
      .eq("id", jobData.id)
      .eq("status", "waiting_for_next_step")
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

    const { campaign_id, progress_data } = jobData;

    console.log("Prosessing job for campaign:", campaign_id);

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

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    const {
      step_1_result: { language },
    } = progressData;

    const { company_name: lead_company_name, linkedin_url: lead_linkedin_url } =
      progress_data;
    const {
      businessInsights: { challengesWithSolutions },
    } = progress_data.insights;
    const updatedLead = JSON.parse(JSON.stringify(progress_data));

    console.log("===== Getting solutions for challenges =====");

    const solutionsPrompt = `
      You are a senior solutions strategist at a top global consultancy.
      Prospexs has already analyzed two things:

      The lead company's specific strategic challenges:
      ${challengesWithSolutions.map(
        (challenge) =>
          `Title: ${challenge.title} Description: ${challenge.description} Sources: ${challenge.source}`
      )}

      Explain how ${campaignData.company_name} directly solves this challenge.
      ● Generate 4 tailored solutions for each identified challenge that show how the
      user's offering directly addresses the lead company's challenges
      ● Reference specific features, workflows, or integrations (e.g., “AI-driven procurement
      platform reducing manual RFP processes by 80%”).
      ● Compare to how ${lead_company_name} currently handles it (status quo or competitor
      approach).
      ● Cite case studies, product documentation, or press releases for validation.
      ● 150-200 words each.
      ● Use external sources to support the data if not available then use the company's own data but always add the sources.
      ● Only keep the source urls and not the name of the source.

      compliance teams provide on-the-ground expertise for country-specific regulations, ensuring
      Job&Talent stays ahead of changing labor laws. This partnership replaces reactive regional
      firefighting with proactive, standardized workforce management, creating a scalable
      foundation for expansion.

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT: You must return ONLY valid JSON in the exact format specified below. Do not include any explanatory text, markdown formatting, or additional content outside the JSON structure.
      Ensure that the matching challenge and solution are in the same object.
      Return the answers in the following JSON format:
      [
        {
          "problemTitle": "Problem 1",
          "problemDescription": "Description of problem 1",
          "sources": [
            "Source 1 for problem 1",
            "Source 2 for problem 1"
          ],
          "solutions": [
            {
              "solutionTitle": "Solution 1 for challenge 1",
              "solutionDescription": "Description of solution 1 for challenge 1",
              "sources": [
                "Source 1 for solution 1 for challenge 1",
                "Source 2 for solution 1 for challenge 1"
              ]
            },
            {
              "solutionTitle": "Solution 2 for challenge 1",
              "solutionDescription": "Description of solution 2 for challenge 1",
              "sources": [
                "Source 1 for solution 2 for challenge 1",
                "Source 2 for solution 2 for challenge 1"
              ]
            }
          ]
        }
      ]
    `;

    const promptLength = solutionsPrompt.length;
    const batchSize = 9800;
    const totalBatches = Math.ceil(promptLength / batchSize);

    console.log(
      `Prompt length: ${promptLength} characters, logging in ${totalBatches} batches:`
    );

    for (let i = 0; i < totalBatches; i++) {
      const start = i * batchSize;
      const end = Math.min(start + batchSize, promptLength);
      const batch = solutionsPrompt.substring(start, end);
      console.log(
        `Prompt batch ${i + 1}/${totalBatches} (chars ${start + 1}-${end}):`,
        batch
      );
    }

    const analysisSchema = z.object({
      solutionsWithChallengesOutput: z.array(
        z.object({
          problemTitle: z.string(),
          problemDescription: z.string(),
          sources: z.array(z.string()),
          solutions: z.array(
            z.object({
              solutionTitle: z.string(),
              solutionDescription: z.string(),
              sources: z.array(z.string()),
            })
          ),
        })
      ),
    });

    let solutionsWithChallengesOutput;
    try {
      console.log("Sending request to OpenAI API...");
      const openAiResponse = await openai.responses.parse({
        model: "gpt-4.1",
        tools: [{ type: "web_search_preview" }],
        input: [{ role: "user", content: solutionsPrompt }],
        max_output_tokens: 7000,
        text: {
          format: zodTextFormat(
            analysisSchema,
            "solutionsWithChallengesOutput"
          ),
        },
      });
      solutionsWithChallengesOutput =
        openAiResponse.output_parsed.solutionsWithChallengesOutput;
      console.log("Open ai response:", solutionsWithChallengesOutput);
    } catch (error) {
      console.log("Error OpenAI:", error);
      console.log("Sending request to Anthropic API...");
      const client = new Anthropic({
        apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
      });
      const anthropicResponse = await client.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 7000,
        system: `You are a JSON-only assistant. Your task is to generate an array of problem objects strictly in JSON format. Each object must follow this structure:
          [
            {
              "problemTitle": "<string> - the title of the problem>",
              "problemDescription": "<string> - detailed description of the problem>",
              "sources": ["<string>", "<string>"] - list of sources supporting the problem,
              "solutions": [
                {
                  "solutionTitle": "<string> - title of the solution>",
                  "solutionDescription": "<string> - detailed description of the solution>",
                  "sources": ["<string>", "<string>"] - list of sources supporting the solution
                }
              ]
            }
          ]
          You will not return any markdown and will only return the target audience in a JSON format array of target audience objects without any other text. You will ensure that the JSON response is a valid JSON format and in the language of the user's requested language code: ${language}.`,
        messages: [{ role: "user", content: solutionsPrompt }],
      });
      console.log("Anthropic response:", anthropicResponse.content[0].text);
      let cleanResponse = anthropicResponse.content[0].text.trim();
      const parsedResponse = cleanJsonResponse(cleanResponse);
      solutionsWithChallengesOutput = JSON.parse(parsedResponse);
      console.log("Anthropic response:", parsedResponse);
    }

    const finishedData = progress_data;
    finishedData.insights.businessInsights.challengesWithSolutions =
      solutionsWithChallengesOutput;

    const { error: updateJobError } = await supabase
      .from("jobs")
      .update({
        job_step: 2,
        progress_data: finishedData,
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

    console.log(`Done for:`, progress_data.full_name);

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

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/lead-insight-2' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
