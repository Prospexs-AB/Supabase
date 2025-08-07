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
    const step5Result = progressData.step_5_result || {};

    const {
      unique_selling_points: usps = [],
      problem_solved: problems = [],
      benefits: benefits = [],
    } = step3Result;

    const {
      company_name: name = "Unknown Company",
      summary: description = "No description available",
      country: company_country,
      industry: company_industry,
    } = step2Result;

    const { language = "en" } = step1Result;
    console.log("Language:", language);

    const companyCountry = company_country || "Sweden";
    const isLocal = locale === "local";
    const locationContext = isLocal ? companyCountry : "international markets";
    console.log("Location context:", locationContext);

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
      You are a senior industry analyst at a top global consultancy.

      Your task: Identify 10 high-value target audiences that ${
        campaignData.company_website
      } should reach out to in ${locationContext} to acquire new customers.

      Primary sources:
      - The company's USPs, Benefits, and Problems Solved (already extracted).
      - Website content and product pages.
      - Publicly known customer logos or partnerships (to create “digital twins”).
      - Competitor customer bases (from public case studies, press releases, or industry reports).
      - Industry trends, common challenges, and adoption patterns in this sector.
      - Role-based decision-making dynamics

      MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      FOR EXAMPLE IF THE LANGUAGE CODE IS "sv" THEN THE TEXT SHOULD BE RETURNED IN SWEDISH AND IF THE LANGUAGE CODE IS "en" THEN THE TEXT SHOULD BE RETURNED IN ENGLISH AND SO ON.

      Use the following sources for context:
      - Company USPs, Benefits, and Problems Solved:
        ${
          usps.length > 0
            ? `USPs:\n${usps.map((usp) => `- ${usp.value}`).join("\n")}`
            : ""
        }
        ${
          problems.length > 0
            ? `Problems Solved:\n${problems
                .map((problem) => `- ${problem.value}`)
                .join("\n")}`
            : ""
        }
        ${
          benefits.length > 0
            ? `Benefits:\n${benefits
                .map((benefit) => `- ${benefit.value}`)
                .join("\n")}`
            : ""
        }
      - Website content and product pages:
        ${zenrowsContent}

      Task: Write a 150-200 word audience brief for the target audience:
      [Target Audience Title] in [Country]
      
      Context:
      ● The logged-in user works at ${name}, which operates in ${company_industry}, with ${company_size} employees and headquarters in ${companyCountry}.
      ● Your job is to explain why this audience is a high-value target for ${name}.

      Content Requirements:
      1. Describe the audience's role & responsibilities in their industry and country.
      2. Explain their main challenges with data (e.g., workforce turnover %, regulatory fines,
      market growth rates).
      3. Tie these challenges to ${name} — why they should target this
      audience.
      4. Ground it in public data: Use at least 4 verifiable sources (reports, stats, regulations,
      news).
      5. Write in an analyst tone (consulting-deck style), making it clear why this audience is
      strategically relevant for the user's business.

      Output:
      ● Title: [Decision-Maker Title] at [Type of Company] in [Country]
      ● Audience Brief: 130-180 words of analysis (consulting style, fully contextualized for the
      user's company).
      ● Sources: 4-5 clickable sources (URLs) that support the data.

      Examples for Operations Managers in Spanish Logistics

      Operations Managers in Spain's logistics sector oversee workforce planning, compliance, and
      service-level performance in a market experiencing 15% YoY e-commerce growth (CNMC,
      2024). For a company like [user's company]—operating in the [user's industry] space—these
      decision-makers are critical partners for expanding last-mile capacity and improving operational
      resilience. They face turnover rates of 25-30% among warehouse staff (Eurofound, 2024)
      and heavy administrative burdens from Registro de Jornada requirements—with fines
      reaching €187,000 per infraction (Spanish Labor Inspectorate, 2024). According to PwC's
      Global Ops Pulse Survey (2024), 63% of logistics leaders in Southern Europe identify
      “scaling operations without inflating labor costs” as their top challenge. This makes them highly
      receptive to solutions that combine AI-driven workforce management and integrated
      compliance frameworks, positioning [user's company] as a value-driving partner in addressing
      these pain points.
      Sources: CNMC E-Commerce Report 2024, Eurofound Labor Market Report 2024, Spanish
      Labor Inspectorate 2024, PwC Global Ops Pulse 2024.

      For each target audience segment, provide the below information and ensure the text is returned in the language code: ${language}:
      1. "industry": A specific industry vertical (e.g., "Manufacturing", "Healthcare")
      2. "role": A specific decision-maker role (e.g., "HR Director", "Operations Manager")
      3. "reasoning": Data-backed explanation of fit (2-3 sentences)
      4. "metrics": Array of 2-3 relevant KPIs as objects with:
        - "value": A specific metric (e.g., "45%", "$2.5M")
        - "label": Description of the metric (e.g., "Average Cost Reduction", "Annual Revenue")
      5. "country": The country of the target audience (e.g., "Sweden", "United States")

      MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      Format: JSON array of target audience objects.
    `;

    console.log("Sending request to OpenAI API...");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a senior industry analyst at a top global consultancy.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 2000,
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
      for (let x = new_latest_step + 1; x <= 10; x++) {
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
