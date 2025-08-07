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
    const supabase = createClient(
      "https://lkkwcjhlkxqttcqrcfpm.supabase.co",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxra3djamhsa3hxdHRjcXJjZnBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTMxMzE5OCwiZXhwIjoyMDYwODg5MTk4fQ.e8SijEhKnoa1R8dYzPBeKcgsEjKtXb9_Gd1uYg6AhuA"
    );

    const { data: jobData, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("job_name", "lead-insights")
      .eq("status", "waiting_for_next_step")
      .eq("job_step", 3)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (jobError) {
      console.log("Error getting job:", jobError);
      return new Response(JSON.stringify({ error: jobError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    console.log(
      `===== Starting job processing for job id: ${jobData.id} =====`
    );

    const { error: firrstUpdateJobError } = await supabase
      .from("jobs")
      .update({ status: "processing" })
      .eq("id", jobData.id);

    if (firrstUpdateJobError) {
      console.error(`Error updating job ${jobData.id}:`, firrstUpdateJobError);
      return new Response(
        JSON.stringify({ error: firrstUpdateJobError.message }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
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

    const { company_name: lead_company_name } = progress_data;
    const {
      businessInsights: { challengesWithSolutions },
    } = progress_data.insights;

    console.log("===== Getting objection handling =====");

    // Processing data

    const challengePromises = challengesWithSolutions.map(async (challenge) => {
      const solutionPromises = challenge.solutions.map(async (solution) => {
        const objectionHandlingPrompt = `
        You are a senior B2B strategist at a top consultancy, preparing a sales or success team for high-stakes outreach.
          Prospexs has already identified:
          - The lead company's current business challenges: ${challenge.description}.
          - The user's proposed solution: ${solution.solutionDescription}.
          - The projected impact of implementing that solution: ${solution.impactDescription}.

          Now, your task is to anticipate 4 realistic objections the lead company might raise—even when the impact is strong.

          For each objection, follow this format:
          1. Objection
          2. Rebuttal
          3. Sources

          ● List 4 realistic objections decision-makers at ${lead_company_name} might raise (e.g., cost,
          integration complexity, ROI skepticism, vendor risk).
          ● For each objection, write a 50-75 word rebuttal using:
            ○ Benchmarks from similar implementations (ROI timelines, adoption rates).
            ○ Security/compliance references (ISO certifications, GDPR compliance).
            ○ Cost/ROI comparisons from credible reports or competitor case studies.
          ● 4 x 50-75 words each.

          IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
          IMPORTANT: You must return ONLY valid JSON in the exact format specified below. Do not include any explanatory text, markdown formatting, or additional content outside the JSON structure.
          Return the answers in the following JSON format:
          {
            "solutionTitle": "Solution for challenge",
            "solutionDescription": "Description here",
            "impactTitle": "Impact for challenge",
            "impactDescription": "Impact description here",
            "objectionHandling": [
              {
                "objection": "Objection text here",
                "rebuttal": "Rebuttal text here",
                "source": [ "Source 1", "Source 2" ]
              }
            ]
          }
        `;

        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: objectionHandlingPrompt,
            },
          ],
          temperature: 0.7,
          max_tokens: 1500,
        });

        console.log("Successfully analyzed content with OpenAI");
        const analysis = completion.choices[0].message.content;
        console.log("OpenAI analysis:", analysis);

        let text = analysis.trim();
        console.log("objection handling text", text);
        console.log(
          "objection handling text end:",
          text.substring(text.length - 500)
        );

        const cleanText = cleanJsonResponse(text);

        return JSON.parse(cleanText);
      });

      const results = await Promise.all(solutionPromises);
      challenge.solutions = results;
      return challenge;
    });

    const finalChallenges = await Promise.all(challengePromises);
    const finishedData = progress_data;
    finishedData.insights.businessInsights.challengesWithSolutions =
      finalChallenges;

    // Handle setting up next step

    const { error: updateJobError } = await supabase
      .from("jobs")
      .update({
        job_step: 4,
        progress_data: finishedData,
        status: "waiting_for_next_step",
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

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/lead-insight-4' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
