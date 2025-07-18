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

function cleanHtmlContent(html: string): string | null {
  try {
    const textContent = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const cleanedContent = textContent
      .replace(/\b(undefined|null|NaN)\b/gi, "")
      .replace(/[^\S\r\n]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();
    if (cleanedContent.length < 200) {
      console.log("Content too short, might be invalid");
      return null;
    }
    console.log(`Extracted ${cleanedContent.length} characters of content`);
    return cleanedContent;
  } catch (error) {
    console.error("Error cleaning content:", error);
    return null;
  }
}

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

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    console.log("Analyzing content with OpenAI...");
    console.log("Lead location:", locale);

    // Extract company info and insights with null checks
    const step3Result = progressData.step_3_result || {};
    const step2Result = progressData.step_2_result || {};
    const step1Result = progressData.step_1_result || {};

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
    console.log("Language:", language);

    // Get country context for location targeting
    // Default to Sweden if not provided (for Sellpy specifically)
    const companyCountry = country || "Sweden";
    const isLocal = locale === "local";
    // Set location context based on local/international choice
    const locationContext = isLocal ? companyCountry : "international markets";

    const params = new URLSearchParams({
      url: campaignData.company_website,
      apikey: "76b884f7acc89f1e898567300acc7d8f95157c1c",
    });

    console.log("Scraping URL:", campaignData.company_website);
    console.log(
      "Using ZenRows API key:",
      Deno.env.get("ZENROWS_API") ? "Present" : "Missing"
    );

    const response = await fetch(
      `https://api.zenrows.com/v1/?${params.toString()}`
    );

    console.log("ZenRows response status:", response.status);
    const html = await response.text();
    console.log("Raw HTML length:", html.length);
    console.log("Raw HTML preview:", html.substring(0, 500));

    const zenrowsContent = cleanHtmlContent(html);

    const prompt = `
      You are a senior industry analyst at a global consultancy.

      Based on the provided USPs, Benefits, and Problems Solved of ${name} - combined
      with relevant industry trends, public customer information, and market positioning - identify 10
      high-value target audiences that the company should reach out to in ${companyCountry} to acquire
      new customers.

      Use the following sources for context:
      - Company USPs, Benefits, and Problems Solved:
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
            ? `Benefits:\n${benefits
                .map((benefit) => `- ${benefit}`)
                .join("\n")}`
            : ""
        }
      - Website content and product pages:
        ${zenrowsContent.substring(0, 8000)}
      - Publicly known customer logos or partnerships
      - Industry trends, common challenges, and adoption patterns in this sector
      - Role-based decision-making dynamics in B2B sales

      Each audience must:
      - Be titled in the format: [Decision-Maker Title] at [Type of Company] in [Country] (e.g.,
      “Legal General Counsel at Large B2B FinTech Companies in Sweden”)
      - Include only job titles that are easily searchable via B2B tools like ZoomInfo, Lusha, Apollo, or
      LinkedIn
      - Be followed by one paragraph explaining why this is a relevant and high-potential audience,
      using facts, figures, or market logic where available
      - Reference how the company's solution connects directly to the pain points or goals of that
      segment
      - If possible, mention types of companies or examples that fall into that audience

      If clear industry targets are not available, use related benchmarks and similar buyer patterns to
      suggest logical alternatives.

      For each target audience segment, provide:
      1. "industry": A specific industry vertical (e.g., "Manufacturing", "Healthcare")
      2. "role": A specific decision-maker role (e.g., "HR Director", "Operations Manager")
      3. "reasoning": Data-backed explanation of fit (2-3 sentences)
      4. "metrics": Array of 2-3 relevant KPIs as objects with:
        - "value": A specific metric (e.g., "45%", "$2.5M")
        - "label": Description of the metric (e.g., "Average Cost Reduction", "Annual Revenue")
      5. "country": The country of the target audience (e.g., "Sweden", "United States")

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

      const new_latest_step = 6;
      const cleanFurtherProgress = {};
      for (let x = new_latest_step + 1; x <= 9; x++) {
        const keyName = `step_${x}_result`;
        cleanFurtherProgress[keyName] = null;
      }
      const { error: progressError } = await supabase
        .from("campaign_progress")
        .update({
          latest_step: new_latest_step,
          step_6_result: {
            target_audience: parsedAnalysis,
            locale,
          },
          ...cleanFurtherProgress,
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
