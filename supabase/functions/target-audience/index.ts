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
      company_size,
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

      Task: Write a 200-250 word audience brief for the target audience:
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
      ● Audience Brief: 200-250 words of analysis (consulting style, fully contextualized for the
      user's company).
      ● Sources: 4-5 sources that support the data (Only URL).
      ● Only keep the source urls and not the name of the source.

      For each target audience segment, provide the below information and ensure the text is returned in the language code: ${language}:
      1. "industry": A specific industry vertical (e.g., "Manufacturing", "Healthcare")
      2. "role": A specific decision-maker role (e.g., "HR Director", "Operations Manager")
      3. "audience_brief": Audience brief for the target audience
      4. "metrics": Array of 2-3 relevant KPIs as objects with:
        - "value": A specific metric (e.g., "45%", "$2.5M")
        - "label": Description of the metric (e.g., "Average Cost Reduction", "Annual Revenue")
      5. "country": The country of the target audience (e.g., "Sweden", "United States")
      6. "sources": Array of 4-5 sources that support the data (Only URL).

      Try to use external sources to support the data if not available then use the company's own data.

      MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT: Return in a JSON format array of target audience objects without any other text. Do not include any explanatory text, markdown formatting, or additional content outside the JSON structure.
      [
        {
          "industry": "Manufacturing",
          "role": "HR Director",
          "audience_brief": "The HR Director is responsible for the company's workforce and is a high-value target for the company.",
          "metrics": [{ "value": "45%", "label": "Average Cost Reduction" }],
          "country": "Sweden",
          "sources": ["https://www.google.com"]
        }
      ]
      `;

    // Log prompt in batches of 10,000 characters for better readability
    const promptLength = prompt.length;
    const batchSize = 9800;
    const totalBatches = Math.ceil(promptLength / batchSize);

    console.log(
      `Prompt length: ${promptLength} characters, logging in ${totalBatches} batches:`
    );

    for (let i = 0; i < totalBatches; i++) {
      const start = i * batchSize;
      const end = Math.min(start + batchSize, promptLength);
      const batch = prompt.substring(start, end);
      console.log(
        `Prompt batch ${i + 1}/${totalBatches} (chars ${start + 1}-${end}):`,
        batch
      );
    }

    const targetAudienceSchema = z.object({
      target_audience: z.array(
        z.object({
          industry: z.string(),
          role: z.string(),
          audience_brief: z.string(),
          metrics: z.array(z.object({ value: z.string(), label: z.string() })),
          country: z.string(),
          sources: z.array(z.string()),
        })
      ),
    });

    let targetAudience;
    try {
      console.log("Sending request to OpenAI API...");
      const openAiResponse = await openai.responses.parse({
        model: "gpt-4.1",
        tools: [{ type: "web_search_preview" }],
        input: [{ role: "user", content: prompt }],
        max_output_tokens: 7000,
        text: {
          format: zodTextFormat(targetAudienceSchema, "target_audience"),
        },
      });
      targetAudience = openAiResponse.output_parsed.target_audience;
    } catch (error) {
      console.log("Error OpenAI:", error);
      console.log("Sending request to Anthropic API...");
      const client = new Anthropic({
        apiKey:
          "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",
      });
      const anthropicResponse = await client.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 7000,
        messages: [{ role: "user", content: prompt }],
      });
      console.log(
        "Anthropic response:",
        anthropicResponse.content[0].text.slice(-199)
      );
      targetAudience = JSON.parse(anthropicResponse.content[0].text);
      console.log("Anthropic analysis:", targetAudience);
      console.log("Successfully analyzed content with Anthropic");
    }

    const new_latest_step = 6;
    const cleanFurtherProgress = {};
    for (let x = new_latest_step + 1; x <= 10; x++) {
      const keyName = `step_${x}_result`;
      cleanFurtherProgress[keyName] = null;
    }

    const { error: progressUpdateError } = await supabase
      .from("campaign_progress")
      .update({
        latest_step: new_latest_step,
        step_6_result: {
          target_audience: targetAudience,
          locale,
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

    return new Response(JSON.stringify({ data: targetAudience }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
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
