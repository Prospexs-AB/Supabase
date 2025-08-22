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

    if (campaignError) {
      console.error("Error updating campaign:", campaignError);
      return new Response(
        JSON.stringify({ error: "Error updating campaign" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: campaignProgressData, error: campaignProgressError } =
      await supabase
        .from("campaign_progress")
        .select("*")
        .eq("id", campaignData.progress_id)
        .single();

    if (campaignProgressError) {
      console.error("Error getting campaign progress:", campaignProgressError);
      return new Response(
        JSON.stringify({ error: "Error getting campaign progress" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { step_1_result } = campaignProgressData;
    const { language: language_code } = step_1_result;
    console.log("Language code:", language_code);

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
    const prompt = `
    Give me a brief but information-rich paragraph describing ${company_website}.
      The paragraph should include:
        - What the company does (product/service)
        - What makes it stand out or unique
        - Where it's based
        - Key facts and figures (revenue, funding, number of users/clients, valuation, etc.)
        - Notable partnerships or customers
        - Any recent news, launches, or updates
      Write it as a single, concise paragraph—not in bullet points.

      MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language_code}.
      FOR EXAMPLE IF THE LANGUAGE CODE IS "sv" THEN THE TEXT SHOULD BE RETURNED IN SWEDISH AND IF THE LANGUAGE CODE IS "en" THEN THE TEXT SHOULD BE RETURNED IN ENGLISH AND SO ON.

      For reference, follow the style and level of detail in these examples:

      Example 1: Description Example for www.teamtailor.com:
        Teamtailor is a Stockholm-based recruitment software company founded in 2013. They
        offer an all-in-one Applicant Tracking System (ATS) combined with employer branding
        tools, designed to help companies attract, engage, and hire top talent efficiently. Their
        platform is trusted by over 10,000 companies and 200,000+ users worldwide.
        
        As of May 2025, Teamtailor has approximately 530 employees across five continents
        and generates an annual revenue of $75 million . The company has raised $10 million in
        funding to date.

      Example 2: Description Example for www.remote.com
        Remote is a San Francisco-based HR tech company founded in 2019 by Job van der
        Voort and Marcelo Lebre. They offer a global employment platform that helps businesses
        hire, manage, and pay employees and contractors in over 200 countries without needing
        local entities.

        Their services include Employer of Record (EOR), global payroll, contractor
        management, benefits administration, and compliance solutions. Remote owns legal
        entities in multiple countries, ensuring compliance with local labor and tax laws. They
        also provide tools like HRIS, time tracking, and expense management.

      Example 3: Description Example for www.zimpler.com
        Zimpler is a Swedish fintech company founded in 2012, specializing in instant
        account-to-account (A2A) payment solutions. Their platform enables businesses to
        facilitate seamless, secure, and real-time transactions across various markets, including
        iGaming, e-commerce, and financial services.
        
        What sets Zimpler apart is its focus on simplifying complex payment processes. Their
        services include instant deposits and payouts, cross-border transactions, and tailored
        solutions like Zimpler Go, which streamlines user onboarding and payments. Operating
        under the supervision of the Swedish Financial Supervisory Authority, Zimpler ensures
        compliance with stringent regulatory standards.

      Example 4: Description Example for www.hedvig.com
        Hedvig is a Stockholm-based digital insurance company founded in 2017, aiming to
        simplify and modernize the insurance experience. Launched in 2018, Hedvig offers a
        range of insurance products including home, car, pet, and accident insurance, all
        managed through a user-friendly app that allows for quick claims and flexible coverage
        without binding periods. The company has attracted over 130,000 customers and has
        raised approximately $99 million in funding from investors like Obvious Ventures and
        Adelis Equity Partners. In 2023, Hedvig formed a strategic partnership with SEB, further
        solidifying its position in the Swedish market. With a focus on digital convenience and
        customer-centric services, Hedvig continues to redefine insurance for the modern
        consumer.

      Example 5: Description Example for www.legora.com
        Legora is a Stockholm-founded legal tech startup launched in 2023, offering a
        collaborative AI platform that helps lawyers review, draft, and research more efficiently.
        With offices in New York, London, and Stockholm, Legora serves over 250 clients across
        20 countries, including top firms like Cleary Gottlieb, Goodwin, Bird & Bird, and
        Mannheimer Swartling. Their standout features include a Microsoft Word add-in and a
        "tabular review" tool that transforms document analysis into an interactive grid. In May
        2025, Legora raised an $80 million Series B funding round led by ICONIQ and General
        Catalyst, bringing its valuation to $675 million. The company, rebranded from Leya in
        early 2025, is recognized for its user-friendly interface and deep collaboration with
        clients, positioning itself as a strong competitor to established players like Harvey in the
        legal AI space.

      Example 6: Description Example for www.monday.com
        Monday.com is a Tel Aviv-based work management platform founded in 2012 (originally
        called dapulse) that enables teams to build custom workflows, manage projects, and
        automate processes without writing code. Since its IPO in 2021, the company has grown
        rapidly, serving over 245,000 customers worldwide across industries like marketing,
        sales, HR, and IT. In Q1 2025, monday.com reported $282.3 million in revenue—a 30%
        year-over-year increase - and reached $972 million in revenue for fiscal year 2024, with
        a net dollar retention rate of 112% . The platform has expanded into enterprise service
        management with AI-powered tools, including autonomous agents for incident
        resolution, and continues to roll out features like AI Blocks, embedded Microsoft 365
        integration, and live spreadsheets . With a global team of over 3,000 employees and a
        strong push into the enterprise market, monday.com is positioning itself as a leading
        “Work OS” for businesses of all sizes.

        Please analyze the content below and create a brief company profile following the above structure, make it around 1000 plus words, use more if needed.
        The content below is from the company website, use the content to create the profile and also search for latest information about the company to add relevant points.

        ${content}

        Create 3 points of interest about the company such as founded year, location, number of employees, number of cutomers and other points similar to these that can be interesting to know.
        Use data that is available in the content and make sure this information is accurate and not made up.
        If the information is not available, use another point to interest to replace it.

        Return the name of the company and make sure it is accurate.

        Return the country of the company if its available in the content, if not keep it empty.
        Return the industry of the company if its available in the content, if not keep it empty.
        Return the size of the company if its available in the content, if not keep it empty.

        Return ONLY a valid JSON object in this exact format (no markdown formatting, no backticks):
        {
          "summary": "your analysis here",
          "points_of_interest": [
          { "point of interest 1": "value" },
          { "point of interest 2": "value" },
          { "point of interest 3": "value" },
          ],
          "company_name": "value",
          "country": "value",
          "industry": "value",
          "company_size": "value"
        }
    `;

    const analysisSchema = z.object({
      analysis: z.object({
        summary: z.string(),
        points_of_interest: z.array(
          z.object({
            point_of_interest: z.string(),
            value: z.string(),
          })
        ),
        company_name: z.string(),
        country: z.string(),
        industry: z.string(),
        company_size: z.string(),
      }),
    });

    console.log("Sending request to OpenAI API...");
    // const openAiResponse = await openai.responses.create({
    //   model: "gpt-4.1",
    //   tools: [{ type: "web_search_preview" }],
    //   input: prompt,
    // });

    const openAiResponse = await openai.responses.parse({
      model: "gpt-4.1",
      tools: [{ type: "web_search_preview" }],
      input: [{ role: "user", content: prompt }],
      max_output_tokens: 4096,
      text: {
        format: zodTextFormat(analysisSchema, "analysis"),
      },
    });

    console.log("Successfully analyzed content with OpenAI");
    const { analysis } = openAiResponse.output_parsed;
    console.log("OpenAI analysis:", analysis);

    try {
      const new_latest_step = 2;
      const cleanFurtherProgress = {};
      for (let x = new_latest_step + 1; x <= 10; x++) {
        const keyName = `step_${x}_result`;
        cleanFurtherProgress[keyName] = null;
      }

      await supabase
        .from("campaign_progress")
        .update({
          latest_step: new_latest_step,
          step_2_result: analysis,
          ...cleanFurtherProgress,
        })
        .eq("id", campaignData.progress_id);

      return new Response(JSON.stringify({ data: analysis }), {
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
