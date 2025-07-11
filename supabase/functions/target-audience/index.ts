// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4.20.1";

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
      status: 200,
      headers: corsHeaders,
    });
  }

  const supabase = createClient(
    "https://lkkwcjhlkxqttcqrcfpm.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxra3djamhsa3hxdHRjcXJjZnBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTMxMzE5OCwiZXhwIjoyMDYwODg5MTk4fQ.e8SijEhKnoa1R8dYzPBeKcgsEjKtXb9_Gd1uYg6AhuA"
  );

  try {
    const userId = await getUserId(req, supabase);

    const body = await req.json();

    const { campaign_id, locale } = body;

    if (!campaign_id) {
      return new Response(
        JSON.stringify({ error: "campaign_id is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    if (!locale) {
      return new Response(JSON.stringify({ error: "locale is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const { data: campaignData, error: campaignError } = await supabase
      .from("campaigns")
      .select("*")
      .eq("user_id", userId)
      .eq("id", campaign_id)
      .single();

    console.log("Campaign query result:", { campaignData, campaignError });

    if (campaignError) {
      return new Response(JSON.stringify({ error: campaignError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    console.log("Campaign data found:", JSON.stringify(campaignData, null, 2));
    console.log("Campaign progress_id:", campaignData.progress_id);

    const { data: progressData, error: progressError } = await supabase
      .from("campaign_progress")
      .select("*")
      .eq("id", campaignData.progress_id)
      .single();

    console.log("Progress query result:", { progressData, progressError });

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    console.log("Analyzing content with OpenAI...");
    console.log("Progress data:", JSON.stringify(progressData, null, 2));
    console.log("Step 1 result:", progressData.step_1_result);
    console.log("Step 2 result:", progressData.step_2_result);
    console.log("Step 3 result:", progressData.step_3_result);
    console.log("Lead location:", locale);
    console.log("Language:", locale);

    // Extract company info and insights with null checks
    const step3Result = progressData.step_3_result || {};
    const step2Result = progressData.step_2_result || {};
    const step1Result = progressData.step_1_result || {};

    console.log("Raw step results:");
    console.log("Step 1 result (raw):", step1Result);
    console.log("Step 2 result (raw):", step2Result);
    console.log("Step 3 result (raw):", step3Result);

    const {
      unique_selling_points: usps = [],
      problem_solved: problems = [],
      benefits: benefits = [],
    } = step3Result;

    const {
      company_name: name = "Unknown Company",
      summary: description = "No description available",
      country,
    } = step2Result;

    const { language = "en" } = step1Result;

    console.log("Extracted data:");
    console.log("USPs:", usps);
    console.log("Problems:", problems);
    console.log("Benefits:", benefits);
    console.log("Company name:", name);
    console.log("Description:", description);
    console.log("Country:", country);
    console.log("Language:", language);
    // Get country context for location targeting
    // Default to Sweden if not provided (for Sellpy specifically)
    const companyCountry = country || "Sweden";
    const isLocal = locale === "local";
    // Set location context based on local/international choice
    const locationContext = isLocal ? companyCountry : "international markets";

    const prompt = `
      Generate 3-5 highly targeted audience segments for a company with these details:

      Company: ${name}
      Description: ${description}
      Company Country: ${companyCountry}
      Location Focus: ${
        isLocal
          ? `Local (${companyCountry})`
          : "International (outside of " + companyCountry + ")"
      }
      Language: ${language === "en" ? "English" : "Swedish"}

      Company Insights:
      ${
        usps.length > 0
          ? `USPs:\n${usps.map((usp) => `- ${usp}`).join("\n")}`
          : ""
      }
      ${
        problems.length > 0
          ? `Problems Solved:\n${problems
              .map((problem) => `- ${problem}`)
              .join("\n")}`
          : ""
      }
      ${
        benefits.length > 0
          ? `Benefits:\n${benefits.map((benefit) => `- ${benefit}`).join("\n")}`
          : ""
      }

      For each target audience segment, provide:
      1. "industry": A specific industry vertical (e.g., "Manufacturing", "Healthcare")
      2. "role": A specific decision-maker role (e.g., "HR Director", "Operations Manager")
      3. "reasoning": Data-backed explanation of fit (2-3 sentences)
      4. "metrics": Array of 2-3 relevant KPIs as objects with:
        - "value": A specific metric (e.g., "45%", "$2.5M")
        - "label": Description of the metric (e.g., "Average Cost Reduction", "Annual Revenue")

      Geographic Focus: ${locationContext}
      ${
        isLocal
          ? `IMPORTANT: The target audiences MUST be specific to ${companyCountry}'s market. ALWAYS include "${companyCountry}" at the end of the industry name.`
          : `IMPORTANT: The target audiences should focus on markets OUTSIDE of ${companyCountry}. Do not include ${companyCountry} in the target audiences.`
      }

      Format: JSON array of target audience objects.
      `;

    console.log("Sending request to OpenAI API...");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a business analyst creating detailed company profiles. Focus on extracting and presenting concrete metrics and specific details about the company's operations, scale, and achievements. Always prefer specific numbers over general statements.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    console.log("Successfully analyzed content with OpenAI");
    const analysis = completion.choices[0].message.content;
    console.log("OpenAI analysis:", analysis);

    try {
      let cleanAnalysis = analysis.trim();
      if (cleanAnalysis.startsWith("```json")) {
        cleanAnalysis = cleanAnalysis
          .replace(/^```json\s*/, "")
          .replace(/\s*```$/, "");
      } else if (cleanAnalysis.startsWith("```")) {
        cleanAnalysis = cleanAnalysis
          .replace(/^```\s*/, "")
          .replace(/\s*```$/, "");
      }

      const parsedAnalysis = JSON.parse(cleanAnalysis);
      console.log("Parsed analysis:", parsedAnalysis);

      const { error: progressError } = await supabase
        .from("campaign_progress")
        .update({
          latest_step: 6,
          step_6_result: {
            target_audience: parsedAnalysis,
          },
        })
        .eq("id", campaignData.progress_id);

      if (progressError) {
        return new Response(JSON.stringify({ error: progressError.message }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }

      return new Response(JSON.stringify({ data: parsedAnalysis }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error parsing JSON response:", error.message);
      console.log("Raw response was:", analysis);
      return new Response(
        JSON.stringify({ error: "Error parsing JSON response" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }
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

    curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/target-audience' \
    --header 'Authorization: Bearer YOUR_JWT_TOKEN' \
    --header 'Content-Type: application/json' \
    --data '{"campaign_id":"123", "locale": "global"}'

*/
