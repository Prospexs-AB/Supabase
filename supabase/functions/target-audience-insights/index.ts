// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "npm:openai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

/**
 * Parses JSON response from OpenAI, handling common formatting issues
 * @param analysis - Raw response string from OpenAI
 * @returns Parsed JSON object or array
 */
const parseOpenAIResponse = (analysis: string) => {
  if (!analysis) {
    throw new Error("Empty response from OpenAI");
  }

  let cleanAnalysis = analysis.trim();

  console.log("Original analysis length:", cleanAnalysis.length);
  console.log("Original analysis preview:", cleanAnalysis.substring(0, 200));

  // Remove markdown code blocks if present
  if (cleanAnalysis.startsWith("```json")) {
    cleanAnalysis = cleanAnalysis
      .replace(/^```json\s*/, "")
      .replace(/\s*```$/, "");
    console.log("Removed ```json blocks");
  } else if (cleanAnalysis.startsWith("```")) {
    cleanAnalysis = cleanAnalysis.replace(/^```\s*/, "").replace(/\s*```$/, "");
    console.log("Removed ``` blocks");
  }

  // Try to find JSON content if it's embedded in other text
  const jsonMatch = cleanAnalysis.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (jsonMatch) {
    cleanAnalysis = jsonMatch[0];
    console.log("Extracted JSON content from mixed text");
  }

  console.log("Cleaned analysis length:", cleanAnalysis.length);
  console.log("Cleaned analysis preview:", cleanAnalysis.substring(0, 200));

  try {
    const result = JSON.parse(cleanAnalysis);
    console.log("Successfully parsed JSON");
    return result;
  } catch (error) {
    console.error("Error parsing JSON response:", error.message);
    console.log("Raw response was:", analysis);
    console.log("Cleaned response was:", cleanAnalysis);

    // Try to fix common JSON formatting issues
    try {
      console.log("Attempting to fix JSON formatting...");
      let fixedJson = cleanAnalysis
        .replace(/(\w+):/g, '"$1":') // Add quotes to unquoted keys
        .replace(/,\s*}/g, "}") // Remove trailing commas
        .replace(/,\s*]/g, "]") // Remove trailing commas in arrays
        .replace(/,\s*,/g, ",") // Remove double commas
        .replace(/\n/g, " ") // Remove newlines
        .replace(/\r/g, "") // Remove carriage returns
        .replace(/\t/g, " ") // Remove tabs
        .replace(/\s+/g, " "); // Normalize whitespace

      console.log("Fixed JSON preview:", fixedJson.substring(0, 200));
      const result = JSON.parse(fixedJson);
      console.log("Successfully parsed fixed JSON");
      return result;
    } catch (secondError) {
      console.error("Failed to fix JSON:", secondError.message);
      throw new Error(
        `Failed to parse JSON response: ${
          error.message
        }. Raw response preview: ${cleanAnalysis.substring(0, 300)}...`
      );
    }
  }
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
    console.log(
      "========== Starting target audience insights function =========="
    );
    const userId = await getUserId(req, supabase);

    const body = await req.json();

    const { campaign_id, recommendations } = body;

    if (!campaign_id) {
      return new Response(
        JSON.stringify({ error: "campaign_id is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    if (!recommendations) {
      return new Response(
        JSON.stringify({ error: "recommendations is required" }),
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

    if (!progressData) {
      return new Response(
        JSON.stringify({ error: "Campaign progress not found" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        }
      );
    }

    const { step_1_result, step_2_result, step_3_result, step_6_result } =
      progressData;

    // Add null checks for step results
    if (!step_1_result || !step_2_result || !step_3_result || !step_6_result) {
      return new Response(
        JSON.stringify({ error: "Missing required step results" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const { company_website: companyWebsite } = campaignData;
    const { language } = step_1_result;
    const { company_name: companyName, summary: companyDescription } =
      step_2_result;
    const { locale: location } = step_6_result;
    const { unique_selling_points, problem_solved, benefits } = step_3_result;

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      throw new Error("OpenAI API key not found in environment variables");
    }
    const openai = new OpenAI({
      apiKey: openaiApiKey,
    });

    const categories = [
      {
        name: "usps",
        label: "Unique Selling Points",
        data: unique_selling_points,
        promptExample: `
          Examples of Deep USPs for www.jobandtalent.com:

          USPs for Supply Chain Managers in Spanish Manufacturing in Spain

          1. AI-Driven Job Matching Prevents Costly Line Disruptions
          For supply chain managers in Spanish manufacturing, unplanned labor shortages can halt
          production lines—costing €30,000-€50,000 per hour in lost output (PwC Manufacturing
          Insights 2024). These disruptions are particularly damaging in automotive and industrial plants,
          where delays ripple across complex supplier networks. Job&Talent's AI-powered matching
          eliminates reliance on traditional resumes and manual screening, cutting time-to-fill by up to
          70% compared to agencies like Adecco or Randstad. This matters in Spain, where line-worker
          turnover exceeds 32% (INE 2024) and shift coverage must remain stable to meet stringent
          delivery schedules. Unlike transactional staffing firms, Job&Talent's algorithm continuously
          evaluates candidate availability, skill sets, and proximity, dynamically matching pre-vetted
          workers to open roles. This reduces emergency overtime, prevents last-minute staffing crises,
          and helps managers maintain on-time delivery KPIs. For high-volume production lines, this
          technology turns reactive firefighting into proactive workforce planning—allowing supply chain
          teams to protect throughput and profitability even under volatile labor conditions.`,
      },
      {
        name: "benefits",
        label: "Benefits",
        data: benefits,
        promptExample: `
        Examples of Deep Benefits for www.jobandtalent.com:

        Benefits for Supply Chain Managers in Spanish Manufacturing in Spain

        1. Higher Workforce Reliability and Reduced Disruption
        For Spanish manufacturers, even brief production interruptions can cascade into costly
        supply-chain disruptions. Job&Talent delivers up to a 29% increase in workforce productivity
        (Job&Talent Case Study 2024) by combining AI-driven matching with continuous worker
        performance tracking, ensuring plants are staffed with qualified and engaged employees. For
        supply chain managers at companies like Gestamp or SEAT, this means fewer missed shifts,
        faster replacements for absent workers, and reduced dependency on overtime. The result:
        higher operational reliability across assembly lines and warehouse operations. Unlike traditional
        staffing agencies, which offer little post-placement engagement, Job&Talent monitors
        performance in real time, empowering managers with actionable insights. This creates a more
        predictable labor pipeline, allowing supply chain teams to focus on strategic planning instead of
        firefighting. The platform effectively turns staffing into a competitive advantage by stabilizing one
        of the most volatile elements of manufacturing operations: the hourly workforce.`,
      },
      {
        name: "problems",
        label: "Problems Solved",
        data: problem_solved,
        promptExample: `
        Examples of Deep Problems Solved for www.jobandtalent.com:

        Problems Solved for Supply Chain Managers in Spanish Manufacturing in Spain

        1. Labor Shortages Disrupting Production Lines
        Spanish manufacturing suffers from chronic labor shortages, with line-worker turnover at
        32% and vacancy rates surpassing 12% in key sub-sectors (INE 2024). For supply chain
        managers at companies like SEAT, Gestamp, and Mondragon, this creates a persistent risk of
        production delays and missed delivery commitments—costing €30,000-€50,000 per hour in
        downtime (PwC Manufacturing Insights 2024). Traditional staffing agencies often can't provide
        pre-vetted candidates fast enough to prevent these disruptions. Job&Talent solves this by
        providing on-demand access to a continuously updated pool of qualified workers across
        multiple regions in Spain. This capability allows managers to backfill roles within hours
        instead of days, maintaining production continuity and protecting customer delivery timelines.
        By combining AI-driven matching with local market expertise, Job&Talent turns labor planning
        into a strategic lever for avoiding line stoppages—directly safeguarding revenue and operational
        performance.`,
      },
    ];

    const listOfInsights = [];
    const recommendationsPromises = recommendations.map(
      async (recommendation) => {
        const { role, industry, reasoning, country } = recommendation;
        let finalInsights = {
          role,
          industry,
          reasoning,
          country,
          insights: {},
        };

        for (const category of categories) {
          const { name, data, label, promptExample } = category;
          const prompt = `
            You are a senior industry analyst. Write 5 consulting-grade paragraphs analyzing how ${companyWebsite}'s ${label} directly affect ${role} at ${industry} in ${country}.

            Language: ${language}

            Requirements per paragraph:
            - 150 words max
            - 3+ quantifiable data points
            - Compare against alternatives
            - Focus on daily workflow impact
            - Use verifiable sources

            Base analysis on:
            ${data.map((singleData) => `- ${singleData.value}`).join("\n")}

            IMPORTANT: Return only JSON. No links or citations in descriptions - put URLs in source array.
            Important: Return ONLY raw JSON. Do not use triple backticks, markdown, or extra explanations.
            Format:
            [
              {
                "title": "Title",
                "description": "Description (no URLs)",
                "source": ["source url here", "source url here"]
              }
            ]
          `;

          console.log("Prompt:", prompt);

          console.log("Sending request to OpenAI API...");
          const openAiResponse = await openai.responses.create({
            model: "gpt-4.1",
            tools: [{ type: "web_search_preview" }],
            input: prompt,
          });

          console.log("Successfully analyzed content with OpenAI");
          const analysis = openAiResponse.output_text;
          console.log("OpenAI analysis:", analysis);
          console.log(
            "OpenAI analysis preview:",
            analysis.substring(0, analysis.length)
          );
          console.log(
            "OpenAI analysis end:",
            analysis.substring(analysis.length - 500)
          );

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
          finalInsights.insights[name] = parsedAnalysis;
        }

        listOfInsights.push(finalInsights);
      }
    );

    await Promise.all(recommendationsPromises);

    const new_latest_step = 7;
    const cleanFurtherProgress = {};
    for (let x = new_latest_step + 1; x <= 10; x++) {
      const keyName = `step_${x}_result`;
      cleanFurtherProgress[keyName] = null;
    }

    const { error: updateError } = await supabase
      .from("campaign_progress")
      .update({
        latest_step: new_latest_step,
        step_7_result: listOfInsights,
        ...cleanFurtherProgress,
      })
      .eq("id", campaignData.progress_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(
      JSON.stringify({
        message: "Successfully created target audience insights",
        data: listOfInsights,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/target-audience' \
    --header 'Authorization: Bearer YOUR_JWT_TOKEN' \
    --header 'Content-Type: application/json' \
    --data '{"campaign_id":"123", "locale": "global"}'

*/
