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
    const { campaign_id } = await req.json();

    const { data: campaignData, error: campaignError } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaign_id)
      .eq("user_id", userId)
      .single();

    if (campaignError) {
      return new Response(JSON.stringify({ error: campaignError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const { data: campaignProgressData, error: campaignProgressError } =
      await supabase
        .from("campaign_progress")
        .select("step_2_result")
        .eq("id", campaignData.progress_id)
        .single();

    if (campaignProgressError) {
      return new Response(
        JSON.stringify({ error: campaignProgressError.message }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const openai = new OpenAI({
      apiKey: apiKey,
    });
    const content = campaignProgressData.step_2_result.summary;

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
    const { company_name, company_website } = campaignData;
    const prompt = `Write a brief but comprehensive analysis for ${company_name} based on the following content from their website ${company_website} and any other verifiable sources. Avoid unnecessary details or lengthy descriptions. Focus on the most important details while keeping it concise:

    ${content.substring(0, 8000)}

    Cover these key points, but be selective and focus on the most significant verified information:

    1. **Unique Selling Points:**
    2. **Problem Solved:**
    3. **Benefits:**

    Here are some examples for each category:

    1. **Unique Selling Points:**
      - year-over-year growth
      - reduced project delivery times

    2. **Problem Solved:**
      - They solve the pain point of poor user experience in digital products through their specialized UI/UX
      - helps companies struggling with outdated software systems by offering custom software solutions

    3. **Benefits:**
      - reduce project development time
      - increase in user engagement after revamping their digital interfaces
      - demonstrated cost savings of approximately 20% in IT infrastructure expenses

    Here are some examples of good concise company analysis:

    Example 1 of unique selling points: Weekend Inc. has achieved a 40% year-over-year growth in client acquisition within the Southeast Asian market, highlighting their successful expansion strategy and expertise in digital product development, as reported in their latest earnings report.

    Example 2 of unique selling points: According to a recent customer case study, Weekend Inc. reduced project delivery times by 25% on average for their clients through their proprietary agile development framework, setting them apart from competitors like Accenture and Deloitte Digital.

    Example 3 of unique selling points: A press release from Weekend Inc. revealed that their tailored software solutions have led to a 30% increase in operational efficiency for clients in the IT services sector, demonstrating their capability in aligning technology roadmaps with business goals.

    Example 1 of problem solved: They solve the pain point of poor user experience in digital products through their specialized UI/UX research services, which have led to a 50% increase in user engagement for several clients after implementing their recommendations.

    Example 2 of problem solved: Weekend Inc. helps companies struggling with outdated software systems by offering custom software solutions; this has enabled clients to reduce operational costs by up to 25% through improved efficiency and automation.

    Example 1 of benefits: Weekend Inc. has been shown to reduce project development time by up to 30% for their clients, as evidenced by a case study with a mid-sized tech firm that reported a reduction in their average project timeline from 10 months to 7 months after implementing Weekend Inc.'s tailor-made software solutions.

    Example 2 of benefits: Clients of Weekend Inc. have achieved a 25% increase in user engagement after revamping their digital interfaces using Weekend Inc.’s UI/UX research services. A specific example includes a client in the e-commerce sector that saw user engagement metrics, such as time spent on site and pages per session, increase significantly post-redesign.

    Example 3 of benefits: Weekend Inc. has demonstrated cost savings of approximately 20% in IT infrastructure expenses for their clients by optimizing technology roadmaps and integrating cost-effective solutions. A financial services client reported saving $500,000 annually on IT costs after adopting Weekend Inc.’s strategic technology planning.

    Key Guidelines:
    - Keep it concise but informative (2-3 sentences maximum for each point)
    - Each category should have around 2-3 points
    - Focus on verified facts and specific details
    - Emphasize unique aspects that differentiate the company
    - If certain information isn't available, focus on what is known
    - Add a source for each point, e.g. "Source: Research", "Source: Independent Client Reviews, "Source: Weekend Inc. Product Pages"

    Please analyze the content and create a company analysis following this structure and dont forget the source for each point.

    Return ONLY a valid JSON object in this exact format (no markdown formatting, no backticks):
    {
      "unique_selling_points": [
        {
          "value": "your analysis here",
          "source": "your source here"
        }
      ],
      "problem_solved": [
        {
          "value": "your analysis here",
          "source": "your source here"
        }
      ],
      "benefits": [
        {
          "value": "your analysis here",
          "source": "your source here"
        }
      ],
    }`;

    console.log("Sending request to OpenAI API...");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a business analyst creating detailed company analysis. Focus on extracting and presenting concrete metrics and specific details about the company's operations, scale, and achievements. Always prefer specific numbers over general statements.",
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

    const { error: updateError } = await supabase
      .from("campaign_progress")
      .update({
        step_3_result: parsedAnalysis,
      })
      .eq("id", campaignData.progress_id);

    if (updateError) {
      console.error("Error updating campaign progress:", updateError);
      return new Response(JSON.stringify({ error: updateError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(JSON.stringify(parsedAnalysis), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
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

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/analyze-company-result' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
