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

    let finalInsights = [];
    for (const recommendation of recommendations) {
      const { role, industry, reasoning, country } = recommendation;

      const prompt = `
      You are a senior industry analyst who deeply understands the role, industry, and country of the
      target audience. It should feel like you've spent years in their shoes - you know their daily
      challenges, how decisions are made, what tools they trust, and what pressures they're under.

      MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      FOR EXAMPLE IF THE LANGUAGE CODE IS "sv" THEN THE TEXT SHOULD BE RETURNED IN SWEDISH AND IF THE LANGUAGE CODE IS "en" THEN THE TEXT SHOULD BE RETURNED IN ENGLISH AND SO ON.

      Your task is to analyze how this company's previously identified USPs, Benefits, and
      Problems Solved affect this specific target audience and return in the language code: ${language}.

      You'll break it down into three categories:
      USPs, Benefits, and Problems Solved.

      For each category, write five detailed paragraphs (not bullet points). Each paragraph should
      explain how a specific USP, benefit, or problem solved directly impacts the target
      audience's workflow, business model, or strategic goals - using real-world context,
      numbers, local trends, and examples whenever possible.
      Your analysis should be:

      - Based on the USPs, Benefits, and Problems Solved already identified for the company
      - Tailored to the decision-makers in the target audience's role and region
      - Supported by verifiable information from the company's website, product documentation,
      customer cases, and reliable public sources
      - Benchmarked against similar tools in the industry if specific data is missing — but never
      made up or assumed

      Keep it fact-based, practical, and locally relevant. Write it like it's meant to be handed to
      someone working in that target audience.
      Use the content below to create the analysis and also search the web for latest information about the company to add relevant points.

      Target Audience: ${role} at ${industry} in ${country}

      Use the following USPs, Benefits, and Problems Solved as your base for this analysis:
      Unique Selling Points: ${unique_selling_points
        .map((usp) => `- ${usp.value}`)
        .join("\n")}
      Benefits: ${benefits.map((benefit) => `- ${benefit.value}`).join("\n")}
      Problems Solved: ${problem_solved
        .map((problem) => `- ${problem.value}`)
        .join("\n")}

      Here are some examples of what the analysis should look like:
      Examples of Target Audiences USPs, Benefits and Problems Solved for www.legora.com:

      USPs for Partners at Large B2B Law Firms in Sweden.

      - USP 1 for Partners at Large B2B Law Firms in Sweden:
        AI-Powered Tabular Review Built for Bulk Due Diligence
        In firms like Mannheimer Swartling, which handles hundreds of M&A, financing, and corporate
        transactions annually, manually reviewing contract batches of 50+ agreements can take days of
        billable associate time. Legora's tabular review converts dozens of documents into sortable data
        tables in minutes. For Partners, this means faster quality control, earlier issue spotting, and the
        ability to commit to more deals under flat-fee pricing - helping to align with today's Swedish
        client expectations around speed and value.

      - USP 2 for Partners at Large B2B Law Firms in Sweden:
        Endorsement by Peers in Scandinavian and European Tier-One Firms
        Seeing top firms like Bird & Bird and Goodwin using Legora gives Swedish Partners confidence
        in the platform. These firms' embrace of the tool - especially in tech and energy deal flows -
        serves as a de-risking signal. Partners in Stockholm can thus position Legora not as a
        speculative investment, but as peer-validated infrastructure that enhances existing strategic
        legal services.

      - USP 3 for Partners at Large B2B Law Firms in Sweden:
        Word Add-In That Honors Swedish Legal Drafting Habits
        Swedish Partners - steeped in chapter-and-verse drafting in Word—hesitate to switch platforms.
        Legora's design philosophy respects this habit by providing AI tools within the familiar Word
        interface. Contract review remains immersive and natural, with added structure. This design
        insight removes training friction and protects workflow continuity, enabling adoption without
        disruption or fatigue.

      - USP 4 for Partners at Large B2B Law Firms in Sweden:
        Product-Led Development with Practicing Lawyer Input
        Legora's platform was shaped through direct collaboration with practicing lawyers - not just
        software engineers. This practitioner-led design resonates with Swedish Partners who often
        lament generic automation solutions that overlook real-world drafting nuance. Legora's layout
        and feature set are therefore not just convenient but strategically aligned with Swedish legal
        drafting patterns and compliance workflows.

      - USP 5 for Partners at Large B2B Law Firms in Sweden:
        Strong Financial Backing and Enterprise-Grade Data Security
        Legora's $675M valuation and leadership backing from heavyweights like ICONIQ Growth and
        General Catalyst matter considerably in Sweden's risk-averse corporate counseling culture.
        Partners evaluating legal tech want assurance of longevity and compliance standards -
        especially GDPR readiness. Legora's investor pedigree and data security infrastructure meet
        those expectations, addressing concerns about vendor stability and data residency.

      Benefits for Partners at Large B2B Law Firms in Sweden.

      - Benefits 1 for Partners at Large B2B Law Firms in Sweden:
        Dramatically Increased Billable Capacity in High-Volume Practice Areas
        Partners running M&A or finance deal teams traditionally allocate associate or paralegal hours
        to comb through agreements. By reducing review times by up to 90%, Legora effectively
        multiplies capacity without hire. This means Partners can open more matter slots per team,
        supporting aggressive growth targets and offering clients faster, smarter, and more efficient
        services.

      - Benefits 2 for Partners at Large B2B Law Firms in Sweden:
        Strengthened Client Retention Through Speed and Insight
        In Sweden's competitive legal market, delivering at speed—especially under fixed-fee billing - is
        a powerful value driver. Legora enables Partners to surface clause-by-clause comparisons and
        risk insights faster, positioning their firms as innovative leaders. This not only wows clients but
        improves retention rates and promotes higher follow-on deal flow, particularly in sectors like
        fintech, energy, and infrastructure.

      - Benefits 3 for Partners at Large B2B Law Firms in Sweden:
        Margin Preservation Amidst Rising Internal Costs
        Swedish firms are increasingly pressured to cover associate and overhead costs within flat-fee
        arrangements. By automating time-draining tasks such as renewal tracking or indemnity
        comparison, Legora reduces internal cost leakage. Partners can therefore maintain healthy
        margins without having to sacrifice investment in strategic client guidance.

      - Benefits 4 for Partners at Large B2B Law Firms in Sweden:
        Internal Consistency & Quality Assurance Across Teams
        Large B2B firms often juggle multiple practice groups—each with different drafting conventions.
        Legora introduces structure by aggregating clause-level data across all practice areas, enabling
        Partners to ensure uniformity. This is invaluable during partner-level quality reviews and
        supports brand consistency, even when junior lawyers come and go.

      - Benefits 5 for Partners at Large B2B Law Firms in Sweden:
        Competitive Differentiation Through Tech-Led Services
        When RFPs come in, Partners positioned as tech-forward advisors secure an edge. Legora's
        structured outputs - like searchable datasets and analytics-driven review summaries—enable
        Partners to responsively service clients with complex compliance or due-diligence needs. By
        marketing their capability to track clauses at scale, firms can elevate perceived value above
        traditional law firm approaches.

      Problems Solved for Partners at Large B2B Law Firms in Sweden

      - Problems Solved 1 for Partners at Large B2B Law Firms in Sweden:
        Manual Bottlenecks That Delay High-Volume Transactions
        Swedish B2B law firms like Mannheimer Swartling, Vinge, and Delphi handle hundreds of
        contracts per week across their M&A, real estate, and banking practices. A single M&A
        transaction might include 30 - 100 supplier, customer, or IP agreements that need to be
        reviewed before closing. Traditionally, this review is done manually by junior associates or
        secondees, often under immense time pressure. These bottlenecks regularly slow down
        closings, increase stress on teams, and introduce risk due to human error. Legora eliminates
        these frictions by automating clause-by-clause review across large batches of contracts in
        minutes. This allows partners to finalize transactions faster, meet aggressive closing schedules,
        and reduce dependency on stretched associate resources - without compromising legal
        precision.

      - Problems Solved 2 for Partners at Large B2B Law Firms in Sweden:
        Margin Compression from Fixed-Fee Work and Client Demands for Efficiency
        The Swedish legal market is shifting toward fixed-fee or capped-fee pricing, particularly in
        transactional and regulatory advisory work. Clients - especially in sectors like real estate,
        renewables, and PE - expect speed, predictability, and transparency. For partners, this creates a
        growing tension: delivering excellent work at scale without escalating internal costs. Without
        automation, profitability often suffers, especially when junior time cannot be billed. Legora
        directly addresses this by significantly reducing the hours needed for contract review and
        making deliverables more standardized and scalable. Partners can thus commit to flat fees with
        confidence, safeguard their margins, and reinvest freed-up capacity into new client matters.

      - Problems Solved 3 for Partners at Large B2B Law Firms in Sweden:
        Inconsistency and Risk in Clause Language Across Teams
        In large Swedish law firms with 200+ lawyers, it's common for the same clause - like
        indemnities, exclusivity, or termination rights - to appear with slight but significant differences
        across deals. This inconsistency can lead to internal friction during partner review, difficulty
        reusing templates, and even client dissatisfaction when clauses don't align with prior advice.
        Legora solves this by structuring all reviewed clauses into a unified, searchable format, allowing
        partners to quickly compare wording across deals, teams, and historical matters. This enables
        more consistent advice across the firm, easier creation of standard templates, and faster
        onboarding of new team members or laterals - all while reducing exposure to drafting risk.

      - Problems Solved 4 for Partners at Large B2B Law Firms in Sweden:
        Cultural Resistance and Low Adoption of Legal Tech
        Despite years of interest in legal tech, many Swedish firms still struggle with actual adoption.
        Partners face internal pushback from senior associates and support staff who are already
        stretched and reluctant to learn new systems. Failed rollouts create skepticism and damage
        innovation credibility within the firm. Legora avoids these pitfalls by embedding itself directly into
        Microsoft Word - the one tool lawyers already live in. No context-switching, no steep learning
        curve. Associates can begin reviewing in a smarter, structured format from day one, while
        partners can extract value from the tool without needing major behavior change. This allows law
        firm innovation efforts to actually land and stick - something Swedish firms have historically
        struggled with.

      - Problems Solved 5 for Partners at Large B2B Law Firms in Sweden:
        Limited Visibility into Key Contract Data Puts Clients and Firms at Risk
        Even the most sophisticated law firms in Sweden rely heavily on unstructured contract data -
        stored in PDFs, tracked in Excel, or remembered ad hoc by specific team members. This
        fragmented visibility becomes a real risk during audits, disputes, or regulatory inspections,
        where clients expect firms to instantly surface key dates, obligations, or risk exposures. Missed
        renewal deadlines or buried exclusivity clauses can damage client relationships and erode trust.
        Legora prevents this by turning every contract into a structured dataset, complete with
        searchable clauses, filtering, and export functionality. Partners can instantly access the
        information they need, across hundreds of documents, and present it to clients or regulators
        within minutes. This transforms the firm from a reactive service provider into a proactive
        strategic partner - especially important in industries facing rising compliance expectations,
        like ESG, financial services, and energy.

        Use the content above to create the analysis and also search the web for latest information about the company to add relevant points.
        Escape all string values to comply with JSON format (no unescaped line breaks or illegal characters).
        Add more usps, problems, and benefits if there are more, the example is just for reference.
        Avoid markdown or explanations. Format strictly as a single valid JSON object.
        Ensure the text is returned in the language code: ${language}.
        Respond with only the JSON object such as:
        {
          "role": "Example Role",
          "industry": "Example Industry",
          "country": "Country",
          "reasoning": "Example Reasoning",
          "insights": {
            "usps": [
              {
                "title": "USP 1: Example USP",
                "description": "Example USP Description",
                "source": "Source: Example Source"
              },
            ],
            "problems": [
              {
                "title": "Problem 1: Example Problem",
                "description": "Example Problem Description",
                "source": "Source: Example Source"
              },
            ],
            "benefits": [
              {
                "title": "Benefit 1: Example Benefit",
                "description": "Example Benefit Description",
                "source": "Source: Example Source"
              },
            ]
          }
        }
      `;

      console.log("Prompt:", prompt);

      console.log("Sending request to OpenAI API...");
      const openAiResponse = await openai.responses.create({
        model: "gpt-4.1",
        tools: [{ type: "web_search_preview" }],
        input: prompt,
      });

      // const completion = await openai.chat.completions.create({
      //   model: "gpt-4o",
      //   messages: [
      //     {
      //       role: "system",
      //       content:
      //         "You are a business analyst creating detailed company profiles. Focus on extracting and presenting concrete metrics and specific details about the company's operations, scale, and achievements. Always prefer specific numbers over general statements.",
      //     },
      //     {
      //       role: "user",
      //       content: prompt,
      //     },
      //   ],
      //   temperature: 0.7,
      //   max_tokens: 2048,
      // });

      console.log("Successfully analyzed content with OpenAI");
      const analysis = openAiResponse.output_text;
      console.log("OpenAI analysis:", analysis);

      console.log("Final 300 characters of raw output:", analysis.slice(-300));

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
      finalInsights.push(parsedAnalysis);
    }

    const new_latest_step = 7;
    const cleanFurtherProgress = {};
    for (let x = new_latest_step + 1; x <= 9; x++) {
      const keyName = `step_${x}_result`;
      cleanFurtherProgress[keyName] = null;
    }

    const { error: updateError } = await supabase
      .from("campaign_progress")
      .update({
        latest_step: new_latest_step,
        step_7_result: finalInsights,
        ...cleanFurtherProgress,
      })
      .eq("id", campaignData.progress_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(JSON.stringify({ data: finalInsights }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
