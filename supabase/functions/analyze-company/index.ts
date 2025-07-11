// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
    const userId = await getUserId(req, supabase);
    const { campaign_id, company_name, company_website } = await req.json();
    if (!company_name || !company_website) {
      return new Response(
        JSON.stringify({ error: "company name and website url is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const { data: campaignData, error: campaignError } = await supabase
      .from("campaigns")
      .update({ company_name, company_website })
      .eq("user_id", userId)
      .eq("id", campaign_id)
      .select()
      .single();

    const params = new URLSearchParams({
      url: company_website,
      apikey: "76b884f7acc89f1e898567300acc7d8f95157c1c",
    });

    console.log("Scraping URL:", company_website);
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

    const content = cleanHtmlContent(html);
    console.log(
      "Extracted content:",
      content ? content.substring(0, 200) + "..." : "No content extracted"
    );

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const openai = new OpenAI({
      apiKey: apiKey,
    });
    if (!content) {
      console.error("No content extracted from website.");
      return new Response(
        JSON.stringify({ error: "Could not extract content from website" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Analyzing content with OpenAI...");
    console.log("Content being sent to OpenAI:", content.substring(0, 1000));
    const prompt = `Write a brief but comprehensive bio for ${company_website} based on the following content from their website and any other verifiable sources. Keep the bio under 150 words. Avoid unnecessary details or lengthy descriptions. Focus on the most important details while keeping it concise:

    ${content.substring(0, 8000)}

    Cover these key points, but be selective and focus on the most significant verified information:

    1. **Brief Overview:**
      - Company's name, industry, and founding year (if available)
      - Core mission and how they solve industry challenges

    2. **Key Products/Services:**
      - Main offerings and their primary benefits
      - Target market and impact

    3. **Scale & Presence:**
      - Geographic reach
      - Notable achievements or metrics
      - Key partnerships (if significant)

    Here are some examples of good concise company descriptions:

    Example 1: Zoho Corporation is an Indian multinational technology company that develops a comprehensive suite of web-based business tools. Founded in 1996 by Sridhar Vembu and Tony Thomas, the company was originally known as AdventNet before rebranding to Zoho in 2009. Headquartered in Chennai, Tamil Nadu, India, Zoho has expanded its presence globally, including a significant office in Austin, Texas.

    Example 2: Mynt is a Swedish fintech company founded in 2018 by Baltsar Sahlin, Johan Obermayer, and Magnus Wideberg. Headquartered in Stockholm, Mynt offers a comprehensive spend management platform tailored for small and medium-sized enterprises (SMEs). The company provides smart corporate credit cards and an intuitive mobile app that seamlessly integrates with various accounting systems, enabling businesses to automate and streamline their expense management processes.

    Example 3: Pleo is a Danish fintech company founded in 2015 by Jeppe Rindom and Niccolò Perra. The company offers a smart spend management platform with physical and virtual company cards that automate expense reporting. Headquartered in Copenhagen, Pleo serves over 37,000 businesses across Europe and employs approximately 1,000 people. The company has raised over $430 million in funding and achieved a $4.7 billion valuation in 2021.

    Key Guidelines:
    - Keep it concise but informative (2-3 paragraphs maximum, under 150 words total)
    - Focus on verified facts and specific details
    - Emphasize unique aspects that differentiate the company
    - If certain information isn't available, focus on what is known

    Please analyze the content and create a brief company profile following this structure.

    Create 3 points of interest about the company such as founded year, location, number of employees, number of cutomers and other points similar to these that can be interesting to know. Use data that is available in the content and make sure this information is accurate and not made up.

    Return the name of the company and make sure it is accurate.

    Return ONLY a valid JSON object in this exact format (no markdown formatting, no backticks):
    {
      "summary": "your analysis here",
      "points_of_interest": [
        { "point of interest 1": "value" },
        { "point of interest 2": "value" },
        { "point of interest 3": "value" },
      ],
      "company_name": "value"
    }`;

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

      await supabase
        .from("campaign_progress")
        .update({ latest_step: 2, step_2_result: parsedAnalysis })
        .eq("id", campaignData.progress_id);

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
    console.error("Error processing request:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/analyze-company' \
    --header 'Authorization: Bearer YOUR_ANON_KEY' \
    --header 'Content-Type: application/json' \
    --data '{"url":"https://example.com"}'

*/
