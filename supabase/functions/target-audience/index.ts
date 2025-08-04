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
    } = step2Result;

    const { language = "en" } = step1Result;
    console.log("Language:", language);

    const {
      linkedin_profile: { country_full_name },
    } = step5Result;

    const companyCountry = country_full_name || "Sweden";
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

    // const prompt = `
    //   You are a senior industry analyst at a global consultancy.

    //   Based on the provided USPs, Benefits, and Problems Solved of ${name} - combined
    //   with relevant industry trends, public customer information, and market positioning - identify 10
    //   high-value target audiences that the company should reach out to in ${companyCountry} to acquire
    //   new customers.

    //   MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
    //   FOR EXAMPLE IF THE LANGUAGE CODE IS "sv" THEN THE TEXT SHOULD BE RETURNED IN SWEDISH AND IF THE LANGUAGE CODE IS "en" THEN THE TEXT SHOULD BE RETURNED IN ENGLISH AND SO ON.

    //   Use the following sources for context:
    //   - Company USPs, Benefits, and Problems Solved:
    //     ${
    //       usps.length > 0
    //         ? `USPs:\n${usps.map((usp) => `- ${usp.value}`).join("\n")}`
    //         : ""
    //     }
    //     ${
    //       problems.length > 0
    //         ? `Problems Solved:\n${problems
    //             .map((problem) => `- ${problem.value}`)
    //             .join("\n")}`
    //         : ""
    //     }
    //     ${
    //       benefits.length > 0
    //         ? `Benefits:\n${benefits
    //             .map((benefit) => `- ${benefit.value}`)
    //             .join("\n")}`
    //         : ""
    //     }
    //   - Website content and product pages:
    //     ${zenrowsContent.substring(0, 8000)}
    //   - Publicly known customer logos or partnerships
    //   - Industry trends, common challenges, and adoption patterns in this sector
    //   - Role-based decision-making dynamics in B2B sales

    //   Each audience must:
    //   - Be titled in the format: [Decision-Maker Title] at [Type of Company] in [Country] (e.g.,
    //   “Legal General Counsel at Large B2B FinTech Companies in Sweden”)
    //   - Include only job titles that are easily searchable via B2B tools like ZoomInfo, Lusha, Apollo, or
    //   LinkedIn
    //   - Be followed by one paragraph explaining why this is a relevant and high-potential audience,
    //   using facts, figures, or market logic where available
    //   - Reference how the company's solution connects directly to the pain points or goals of that
    //   segment
    //   - If possible, mention types of companies or examples that fall into that audience

    //   If clear industry targets are not available, use related benchmarks and similar buyer patterns to
    //   suggest logical alternatives.

    //   For each target audience segment, provide the below information and ensure the text is returned in the language code: ${language}:
    //   1. "industry": A specific industry vertical (e.g., "Manufacturing", "Healthcare")
    //   2. "role": A specific decision-maker role (e.g., "HR Director", "Operations Manager")
    //   3. "reasoning": Data-backed explanation of fit (2-3 sentences)
    //   4. "metrics": Array of 2-3 relevant KPIs as objects with:
    //     - "value": A specific metric (e.g., "45%", "$2.5M")
    //     - "label": Description of the metric (e.g., "Average Cost Reduction", "Annual Revenue")
    //   5. "country": The country of the target audience (e.g., "Sweden", "United States")

    //   MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
    //   Format: JSON array of target audience objects.
    // `;

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

      For each target audience:
      - Title format: [Decision-Maker Title] at [Type of Company] in [Country] (e.g., “HR Directors at
      Large 3PL Logistics Companies in Sweden”).
      - Content: Write a single detailed paragraph (150-200 words) that:
      - Describes why this is a high-potential audience, using facts, figures, or market logic
      (e.g., market size, labor shortages, regulatory shifts).
      - References existing customers of [Company] (digital twins) and suggests lookalike
      companies (e.g., "similar to Job&Talent's work with GLS Spain, this could include
      PostNord or DB Schenker”).
      - Incorporates competitor insights (e.g., who else is targeting them, and how
      [Company] differentiates).
      - Connects their specific pain points or strategic goals to [Company]'s solution,
      referencing relevant USPs, Benefits, or Problems Solved.
      - Explains why now, tying the audience to current market triggers (e.g., labor
      shortages, regulatory compliance pressures, e-commerce growth).
      - Decision-maker relevance: Only include titles that are easily searchable via
      ZoomInfo, Lusha, Apollo, or LinkedIn.
      - Strategic insight: Explain why this segment should be prioritized for outreach,
      considering competitive dynamics, market urgency, and purchasing authority.

      No generic statements: Every paragraph must provide specific, actionable insights based
      on evidence and market context.

      Output format:
      Target Audience 1: [Decision-Maker Title] at [Type of Company] in [Country]
      [150-200-word paragraph: context, customer/competitor analogs, pain points, company
      connection, examples, urgency]
      (Repeat for all 10 target audiences)

      Examples of Target Audiences for www.jobandtalent.com:

      1. HR Directors at National Logistics Providers in Sweden
      HR Directors at logistics companies like PostNord, DB Schenker, and Bring oversee complex
      warehouse and last-mile operations across Sweden. These organizations face turnover rates
      exceeding 35% for warehouse roles and persistent absenteeism averaging 10-15% per shift
      (BLS 2024). Job&Talent's AI-powered matching and attendance tracking, proven to reduce
      absenteeism by up to 20% with clients like GLS Spain, directly addresses these challenges.
      Unlike traditional agencies (e.g., Adecco, Randstad) that rely on manual scheduling, Job&Talent
      delivers real-time dashboards and predictive attendance insights, allowing HR leaders to
      intervene before gaps escalate. With e-commerce volumes in Sweden projected to grow 12%
      YoY through 2026 (PostNord E-Commerce Report 2024), these directors need scalable,
      cost-efficient staffing solutions that can keep pace with demand spikes—making Job&Talent a
      high-priority partner.

      2. Operations Directors at E-Commerce 3PLs in Sweden
      Operations Directors at 3PL providers such as DHL Supply Chain, Aditro Logistics, and
      GEODIS manage high-volume fulfillment centers where on-time performance SLAs exceed
      98%. Seasonal surges often strain their ability to maintain staffing levels, driving up overtime
      costs by 20-25% during peak periods (McKinsey 2024). Job&Talent's AI recruiter Clara can
      onboard hundreds of pre-vetted workers within 48 hours, reducing time-to-fill by 70-80%,
      as seen with its U.S. logistics clients. Competitors like Instawork focus on gig-based
      placements, but Job&Talent offers full-cycle workforce management—from recruitment to
      attendance tracking—helping these directors maintain SLA compliance and cut operational
      firefighting. As Sweden's e-commerce sector continues to expand, this audience urgently needs
      solutions that balance speed, quality, and cost.
      
      3. Heads of Workforce Planning at Large Retail Chains in Sweden
      Retailers like IKEA, H&M, and Axfood employ thousands of hourly workers across stores and
      distribution hubs, facing significant staffing volatility during seasonal peaks. Poor labor
      planning can drive overtime costs up by 20-25% and push utilization below 70% (McKinsey
      Workforce Report 2024). Job&Talent's AI-driven workforce planning optimizes shift
      assignments based on availability, skills, and forecasted demand—helping customers like DHL
      Spain improve labor utilization by 15%. Unlike legacy VMS systems that provide static
      templates, Job&Talent integrates planning, scheduling, and real-time attendance data into a
      single platform. This allows workforce planners to anticipate coverage risks and adjust
      staffing in real time, reducing both under- and over-staffing. For large retailers navigating tight
      margins, this makes Job&Talent a compelling partner for workforce stability.

      4. COOs at Manufacturing Companies in Sweden
      COOs at manufacturers like Volvo Group, Electrolux, and SKF oversee complex production
      lines where labor shortages can halt operations. With turnover rates in manufacturing
      exceeding 30% for line workers (SCB 2024), staffing instability directly affects output and
      profitability. Job&Talent addresses this by providing pre-vetted, performance-tracked workers
      and reducing onboarding times to under 24 hours, enabling plants to maintain continuity
      during labor disruptions. Unlike staffing giants such as Adecco, Job&Talent embeds
      engagement features like milestone tracking and in-app incentives, improving worker
      retention by 15-20%, as reported by its European clients. For COOs managing production in a
      global supply-chain environment, Job&Talent offers a scalable, compliance-ready staffing
      solution that minimizes downtime and boosts operational resilience.
      
      5. Procurement Directors at Multinational Enterprises in Sweden
      Procurement Directors at enterprises such as Ericsson, ABB, and Scania are tasked with
      reducing total workforce costs while ensuring consistent vendor performance. Fragmented
      staffing vendors increase complexity, drive up procurement overhead, and hinder compliance
      oversight. Job&Talent, operating in 10+ countries, enables companies to consolidate
      workforce vendors by up to 40%, delivering 15-25% cost savings through automation and
      streamlined management (Job&Talent Efficiency Study 2024). This global coverage
      differentiates Job&Talent from regional staffing agencies, providing Procurement Directors with
      standardized contracts, integrated dashboards, and centralized compliance reporting.
      With labor cost inflation and regulatory demands rising across Europe, this audience represents
      a strategic entry point for Job&Talent to expand enterprise adoption.

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
            "You are a business analyst creating detailed company profiles. Focus on extracting and presenting concrete metrics and specific details about the company's operations, scale, and achievements. Always prefer specific numbers over general statements.",
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
