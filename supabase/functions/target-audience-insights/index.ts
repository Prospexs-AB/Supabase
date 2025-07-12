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

    const { campaign_id, recommendation } = body;

    if (!campaign_id) {
      return new Response(
        JSON.stringify({ error: "campaign_id is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    if (!recommendation) {
      return new Response(
        JSON.stringify({ error: "recommendation is required" }),
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

    const { step_1_result, step_2_result, step_6_result } = progressData;

    const { language } = step_1_result;
    const { country } = step_2_result;
    const { locale: location } = step_6_result;

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    console.log("Analyzing content with OpenAI...");
    console.log("Lead location:", location);
    console.log("Language:", language);

    console.log(
      `Generating audience insights for ${recommendation.role} in ${recommendation.industry}`
    );
    console.log(
      `Type: ${insightType}, Location: ${location}, Country: ${country}`
    );
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      throw new Error("OpenAI API key not found in environment variables");
    }

    const {
      role,
      industry,
      reasoning,
      companyName = "",
      companyDescription = "",
      companyWebsite = "",
    } = recommendation;

    const basePrompt = `You are an expert business analyst and market researcher specializing in ${
      recommendation.industry
    }. 
      You have access to extensive market data, industry reports, competitor analyses, and consumer behavior studies.
      Your expertise is in analyzing how companies can effectively position their offerings to specific audience segments.

      Focus on ${recommendation.role}s in ${recommendation.industry} ${
      location === "local" ? `in ${country}` : "globally"
    }.

      Use these guidelines for your analysis:
      1. Be extremely specific and data-driven - include concrete numbers, percentages, statistics, and facts
      2. Reference industry benchmarks, reports, trends, and recent market developments
      3. Always mention the company name "${companyName}" explicitly when discussing their offerings
      4. Focus on measurable impacts and outcomes for the audience
      5. Use location-specific insights for ${
        location === "local" ? country : "international"
      } market
      6. Draw connections between company capabilities and audience needs based on market research`;
    let promptContent = "";
    if (insightType === "usps") {
      promptContent = `# Context
      ## Target Audience:
      Role: ${recommendation.role}
      Industry: ${recommendation.industry}
      Market: ${location === "local" ? country : "International"}

      ## Company Information:
      Company Name: ${companyName}
      ${companyDescription ? `Company Description: ${companyDescription}` : ""}
      ${companyWebsite ? `Company Website: ${companyWebsite}` : ""}
      ${
        recommendation.reasoning
          ? `Audience Relevance: ${recommendation.reasoning}`
          : ""
      }

        # Task
        Create 3 highly specific, data-driven Unique Selling Points (USPs) that precisely demonstrate how ${companyName}'s solutions address ${
        recommendation.role
      }s' needs in the ${recommendation.industry} sector ${
        location === "local" ? `in ${country}` : "internationally"
      }.

        Each USP must:
        1. Start with a clear, bold headline highlighting a specific capability or advantage
        2. Include at least 3 precise numerical data points (percentages, statistics, market figures) related to the industry, audience challenges, or solution effectiveness
        3. Reference relevant industry trends, market challenges, or competitive benchmarks specific to the ${
          recommendation.industry
        } sector
        4. Explicitly explain why this capability matters to ${
          recommendation.role
        }s with concrete examples of business impact
        5. Highlight a competitive differentiation based on market research or industry analysis
        6. Focus on the ${
          location === "local"
            ? `local market conditions in ${country}`
            : "international market landscape"
        }

      # Format
      For each USP:
      1. Start with "**USP X: [Compelling Headline]**" as a clear header
      2. Follow with a detailed paragraph that includes:
        - Industry-specific context with supporting data
        - How ${companyName} addresses this specific need
        - Quantified impact or advantage
        - Why this matters specifically to ${recommendation.role}s in ${
        recommendation.industry
      }
      3. End with a "Source:" line that specifies one of:
        - "Company Website" if the information comes from their website
        - The full name of the news outlet if from a news article
        - The name of the industry report or research paper
        - The name of the market research firm or analyst
        - "LinkedIn" if from company LinkedIn data

      USE REAL-WORLD DATA AND SPECIFIC METRICS THROUGHOUT THE RESPONSE.`;
    } else if (insightType === "problems") {
      promptContent = `# Context
      ## Target Audience:
      Role: ${recommendation.role}
      Industry: ${recommendation.industry}
      Market: ${location === "local" ? country : "International"}

      ## Company Information:
      Company Name: ${companyName}
      ${companyDescription ? `Company Description: ${companyDescription}` : ""}
      ${companyWebsite ? `Company Website: ${companyWebsite}` : ""}
      ${
        recommendation.reasoning
          ? `Audience Relevance: ${recommendation.reasoning}`
          : ""
      }

      # Task
      Identify 3 significant, data-backed problems that ${
        recommendation.role
      }s in ${recommendation.industry} face ${
        location === "local" ? `specifically in ${country}` : "internationally"
      } that ${companyName} can solve.

        Each problem must:
        1. Start with a clear, bold headline identifying a specific, documented challenge
        2. Include at least 3 precise numerical data points (percentages, statistics, market figures, survey results) that quantify the problem's impact or prevalence
        3. Reference specific industry reports, market studies, or research findings related to this challenge
        4. Explain the business consequences for ${
          recommendation.role
        }s who don't address this problem
        5. Connect to how ${companyName}'s specific capabilities address this problem based on their offerings
        6. Consider the ${
          location === "local"
            ? `local market context in ${country}`
            : "international market context"
        }

      # Format
      For each problem:
      1. Start with "**Problem X: [Clear Problem Statement]**" as a distinct header
      2. Follow with a detailed paragraph that includes:
        - Data-driven description of the problem with statistics
        - The specific impact on ${recommendation.role}s in ${
        recommendation.industry
      }
      - How ${companyName}'s capabilities provide a solution
      - Why solving this problem creates value for the target audience
      3. End with a "Source:" line that specifies one of:
        - "Company Website" if the information comes from their website
        - The full name of the news outlet if from a news article
        - The name of the industry report or research paper
        - The name of the market research firm or analyst
        - "LinkedIn" if from company LinkedIn data

      USE REAL-WORLD DATA AND SPECIFIC METRICS THROUGHOUT THE RESPONSE.`;
    } else if (insightType === "benefits") {
      promptContent = `# Context
        ## Target Audience:
        Role: ${recommendation.role}
        Industry: ${recommendation.industry}
        Market: ${location === "local" ? country : "International"}

        ## Company Information:
        Company Name: ${companyName}
        ${
          companyDescription ? `Company Description: ${companyDescription}` : ""
        }
        ${companyWebsite ? `Company Website: ${companyWebsite}` : ""}
        ${
          recommendation.reasoning
            ? `Audience Relevance: ${recommendation.reasoning}`
            : ""
        }

      # Task
      Create 3 compelling, measurable benefits that ${
        recommendation.role
      }s in ${
        recommendation.industry
      } would gain from working with ${companyName}, backed by industry data and market research.

        Each benefit must:
        1. Start with a clear, bold headline highlighting a specific, quantifiable outcome
        2. Include at least 3 precise numerical data points (ROI figures, efficiency metrics, performance improvements, market statistics) that demonstrate value
        3. Reference industry benchmarks, comparative performance data, or success metrics relevant to ${
          recommendation.industry
        }
        4. Connect directly to known challenges or goals of ${
          recommendation.role
        }s with evidence
        5. Highlight how ${companyName}'s approach delivers superior results compared to alternatives
        6. Account for the ${
          location === "local"
            ? `local market realities in ${country}`
            : "international market landscape"
        }

      # Format
      For each benefit:
      1. Start with "**Benefit X: [Quantifiable Outcome]**" as a distinct header
      2. Follow with a detailed paragraph that includes:
        - Specific, measurable value with supporting data
        - How this benefit addresses known priorities of ${recommendation.role}s
        - Why this benefit matters in the context of ${recommendation.industry}
        - How ${companyName} delivers this benefit in a differentiated way
      3. End with a "Source:" line that specifies one of:
        - "Company Website" if the information comes from their website
        - The full name of the news outlet if from a news article
        - The name of the industry report or research paper
        - The name of the market research firm or analyst
        - "LinkedIn" if from company LinkedIn data

      USE REAL-WORLD DATA AND SPECIFIC METRICS THROUGHOUT THE RESPONSE.`;
    }
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
          content: promptContent,
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
