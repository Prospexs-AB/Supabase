// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "npm:openai";

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
        .select("*")
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
    const { step_1_result } = campaignProgressData;
    const { language: language_code } = step_1_result;
    console.log("Language code:", language_code);
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

    const zenrowsContent = cleanHtmlContent(html);

    const prompt = `
      Write a brief but comprehensive analysis for ${company_name} based on the following content from their website ${company_website} and any other verifiable sources.
      Avoid unnecessary details or lengthy descriptions.
      Focus on the most important details while keeping it concise.

      MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language_code}.
      FOR EXAMPLE IF THE LANGUAGE CODE IS "sv" THEN THE TEXT SHOULD BE RETURNED IN SWEDISH AND IF THE LANGUAGE CODE IS "en" THEN THE TEXT SHOULD BE RETURNED IN ENGLISH AND SO ON.

      This is the summary of the company thats been generated:
      ${content}

      This it the raw content from the website:
      ${zenrowsContent0}

      Use the content above to create the analysis and also search the web for latest information about the company to add relevant points.
      Cover these key points, but be selective and focus on the most significant verified information:

      1. **Unique Selling Points:**
      2. **Problem Solved:**
      3. **Benefits:**

      Here is the scenario for the unique selling points analysis:

      You are a senior industry analyst at a top global consultancy.
      Your task is to identify 5 Unique Selling Propositions (USPs) of the company listed below.
      Use only:
      - The company's official website
      - Verifiable, publicly available information (such as product pages, news, pricing, press
      releases, customer logos, or use cases)

      Only include what is explicitly stated or strongly supported by the company's materials. Do not
      make assumptions or fabricate details.
      Each USP must:
      - Be specific and clearly grounded in facts
      - Highlight what makes the company stand out from competitors
      - Include any available figures, adoption stats, named customers, or technical differentiators
      - Be useful for matching with other companies facing challenges this company can solve

      Examples of USPs for www.legora.com:
      USP 1: AI-Native “Tabular Review” That Transforms Legal Document Analysis
      Legora's core innovation—“tabular review” - converts unstructured legal documents into
      structured, sortable data tables. This allows legal professionals to analyze 50-100 contracts
      simultaneously, reducing manual review time by up to 90%. In a sector where junior hours are
      under cost pressure and partner margins are thinning, this feature transforms document-heavy
      workflows like M&A and financing. Compared to AI summarization tools, Legora's data-first
      approach offers measurable operational leverage, not just convenience.

      USP 2: Rapid Global Penetration Across Top-Tier Firms
      Legora has secured 250+ law firms as customers across 20+ countries since its 2023 launch,
      including industry heavyweights such as Cleary Gottlieb, Bird & Bird, and Mannheimer
      Swartling. This pace of adoption—faster than Ironclad and rivaling Harvey—is exceptional in a
      sector where procurement cycles typically range from 9 to 18 months. It signals high
      product-market fit, trust in the underlying AI model, and strong early-stage GTM execution.

      USP 3: Aggressively Funded with Strategic Backers and Deep Capital Access
      With over $115M raised and a valuation of ~$675M as of May 2025, Legora is one of the
      fastest-capitalized players in the legal tech sector. Investors include ICONIQ Growth, General
      Catalyst, and unicorn founders from Klarna and Spotify. This not only validates the company's
      strategic relevance but ensures multi-year runway to expand globally, invest in custom AI
      tooling, and defend against emerging challengers in a consolidating space.

      USP 4: Deep Workflow Embedding Through Word Add-Ins and Chat Interfaces
      Unlike many competitors that remain siloed in their UI, Legora integrates directly into Microsoft
      Word via a native add-in, allowing lawyers to access AI insights, clause suggestions, and data
      extraction tools within the environment they already use daily. Combined with legal-specific
      chatbots and AI agents, this lowers switching friction, drives daily active use, and creates
      defensible workflow lock-in—critical in professional services where behavioral inertia is high.

      USP 5: Product-Led Growth Culture with a Lean, Cross-Disciplinary Team
      Legora operates with a 100-person team distributed across Stockholm, London, and New York -
      balancing legal domain expertise with world-class product and engineering talent from Spotify,
      Klarna, and Google. This allows the company to ship rapidly, iterate directly with customers, and
      avoid the bloated product timelines that plague legacy legal software vendors. The lean team
      model is also capital-efficient, with high ROI per employee.

      Here is the scenario for the problem solved analysis:

      You are a senior industry analyst at a top global consultancy. Your task is to identify five
      specific problems or inefficiencies that the company below helps its customers solve.
      Use only verifiable and factual information from:
      - The company's official website
      - Public product documentation, feature pages, case studies, testimonials, or relevant press
      coverage

      Do not make assumptions or fabricate details. If a problem is implied but not backed by clear
      evidence, include the note:
      “The company does not provide specific figures or examples to support this claim.”
      Each problem should:
      - Be written in clear, practical business terms (e.g. manual workload, compliance complexity,
      data visibility issues)
      - Be directly linked to how the company's product or service addresses it
      - Include real metrics, named customers, or outcome-based language where available
      - Be tangible and actionable — avoid abstract or generic phrasing
      Only include what is explicitly stated or strongly supported by the company's materials. Do not
      make assumptions or fabricate details.

      Examples of Problems Solved for www.legora.com:
      Problems Solved 1: Manual Contract Review is a Bottleneck and Profitability Drag
      Even at the most sophisticated firms, associates spend thousands of hours annually extracting
      data from contracts - a task ripe for automation. Legora removes this bottleneck, freeing up
      legal capacity for higher-margin work and reducing the need for document review outsourcing.
      In fixed-fee environments, this improves project profitability by as much as 30 - 40% per
      engagement.

      Problems Solved 2: Legacy Legal Software Is Clunky, Fragmented, and Poorly Designed
      Traditional legal tech tools -often developed 10+ years ago - prioritize function over usability,
      resulting in steep learning curves and poor adoption. Legora's clean UI, intuitive UX, and
      real-time collaboration tools are modeled on consumer-grade platforms (e.g. Notion, Airtable),
      making onboarding faster and daily use more seamless. This is especially attractive to younger
      associates and digital-native in-house counsel.

      Problems Solved 3: Cross-Document Analysis is Practically Impossible at Scale
      Legal teams frequently need to compare dozens of agreements for anomalies - yet no legacy
      tool enables this natively. Legora's tabular comparison format allows clause-level analysis
      across large document sets, replacing hours of toggling between PDFs with actionable insights.
      This is particularly impactful in capital markets, real estate, and fund operations.

      Problem Solved 4: Legal AI Adoption is Stifled by Trust and Risk Concerns
      Many firms remain wary of AI “hallucination” in legal applications. Legora mitigates this risk by
      focusing on extraction, not generation. Its model is deterministic - reading and structuring exact
      contract language rather than inventing legal summaries - making it far more trustworthy in
      regulated environments and under legal liability standards.
      
      Problem Solved 5: Legal Data Lives in Silos, Blocking Operational Insight
      Most law firms and legal departments are sitting on thousands of documents with no searchable
      structure. This blocks analytics, slows risk assessments, and creates audit complexity. Legora
      solves this by making all uploaded documents queryable via tags, filters, and structured fields -
      turning legal archives into living datasets.

      Here is the scenario for the benefits analysis:
      You are a senior industry analyst at a top global consultancy.
      You are analyzing this company to understand what benefits it provides to its customers. Based
      on the company's website and other public, verifiable sources (case studies, testimonials,
      product descriptions), identify 5 tangible benefits customers receive.
      Use only:
      - The company's official website
      - Verifiable, publicly available information (such as product pages, news, pricing, press
      releases, customer logos, or use cases)
      Only include what is explicitly stated or strongly supported by the company's materials. Do not
      make assumptions or fabricate details.
      Each benefit must:
      - Be framed from the customer's perspective
      - Focus on clear, measurable value (e.g. time saved, costs reduced, conversions increased)
      - Include numbers, named customers, quotes, or feature references when available
      - Be helpful for identifying companies that would value these outcomes

      Examples of Benefits for www.legora.com:
      1. Material Time and Cost Reductions Across Core Legal Processes
      Firms using Legora report time savings of up to 90% in contract review, especially in workflows
      like due diligence, commercial lease reviews, and regulatory audits. This allows law firms to
      either increase throughput without hiring or price more competitively in fixed-fee
      engagements—a growing segment driven by client demand for cost predictability. For in-house
      legal teams, it means faster decisions and leaner legal ops.

      2. Structured Legal Data Enables Strategic, Not Just Operational, Value
      By turning contracts into structured datasets, Legora moves legal teams from case-by-case
      review to portfolio-level insight. This allows firms to identify systemic exposure (e.g. termination
      clauses across leases) and gives in-house teams the ability to benchmark risks across
      geographies or subsidiaries. Few platforms in legal tech provide this level of operational
      intelligence without extensive post-processing.

      3. High Client Involvement in Product Development Drives Relevance
      Unlike traditional vendors that ship generic solutions, Legora co-develops features with clients
      like Goodwin. This ensures its roadmap aligns with real-world legal workflows rather than
      assumptions. The result: higher adoption, reduced churn risk, and increased customer lifetime
      value. In consultancy terms, this “co-creation loop” is a moat in itself.

      4. Enterprise-Grade Scalability for Global Legal Operations
      Legora's architecture supports multilingual document review and deployment across multiple
      legal jurisdictions. This enables global law firms and multinational legal departments to
      consolidate tools across borders, reducing vendor fragmentation. The scalability is further
      reinforced by API integrations with CRM, DMS, and e-billing systems - making Legora a system
      of record, not just a tool.

      5. Audit-Ready Outputs Support Governance and Compliance at Scale
      Legora's structured exports - down to party names, payment triggers, and obligations—are
      formatted for compliance reporting and internal audits. This eliminates the error-prone,
      copy-paste approach common in Excel or Word and reduces downstream liability. For regulated
      sectors like finance and energy, this transforms legal from a bottleneck to a strategic partner in
      risk management.

      Please analyze the content and create a company analysis following this structure and dont forget the source for each point AND USE THE LANGUAGNE FROM THE LANGUAGE CODE: ${language_code}.
      Use the example above as a reference for the analysis and each point should be descriptive if possible having 2-3 sentences unless more are needed.
      Each value should be more than 1 sentence.
      The source should be the just the full url of the page where the information is from.
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
      }
    `;

    console.log("Sending request to OpenAI API...");
    const openAiResponse = await openai.responses.create({
      model: "gpt-4.1",
      tools: [{ type: "web_search_preview" }],
      input: prompt,
    });

    console.log("Successfully analyzed content with OpenAI");
    const analysis = openAiResponse.output_text;
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

    return new Response(
      JSON.stringify({
        message: "Company analysis completed successfully",
        data: parsedAnalysis,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
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
