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

      // const prompt = `
      // You are a senior industry analyst who deeply understands the role, industry, and country of the
      // target audience. It should feel like you've spent years in their shoes - you know their daily
      // challenges, how decisions are made, what tools they trust, and what pressures they're under.

      // MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      // FOR EXAMPLE IF THE LANGUAGE CODE IS "sv" THEN THE TEXT SHOULD BE RETURNED IN SWEDISH AND IF THE LANGUAGE CODE IS "en" THEN THE TEXT SHOULD BE RETURNED IN ENGLISH AND SO ON.

      // Your task is to analyze how this company's previously identified USPs, Benefits, and
      // Problems Solved affect this specific target audience and return in the language code: ${language}.

      // You'll break it down into three categories:
      // USPs, Benefits, and Problems Solved.

      // For each category, write five detailed paragraphs (not bullet points). Each paragraph should
      // explain how a specific USP, benefit, or problem solved directly impacts the target
      // audience's workflow, business model, or strategic goals - using real-world context,
      // numbers, local trends, and examples whenever possible.
      // Your analysis should be:

      // - Based on the USPs, Benefits, and Problems Solved already identified for the company
      // - Tailored to the decision-makers in the target audience's role and region
      // - Supported by verifiable information from the company's website, product documentation,
      // customer cases, and reliable public sources
      // - Benchmarked against similar tools in the industry if specific data is missing — but never
      // made up or assumed

      // Keep it fact-based, practical, and locally relevant. Write it like it's meant to be handed to
      // someone working in that target audience.
      // Use the content below to create the analysis and also search the web for latest information about the company to add relevant points.

      // Target Audience: ${role} at ${industry} in ${country}

      // Use the following USPs, Benefits, and Problems Solved as your base for this analysis:
      // Unique Selling Points: ${unique_selling_points
      //   .map((usp) => `- ${usp.value}`)
      //   .join("\n")}
      // Benefits: ${benefits.map((benefit) => `- ${benefit.value}`).join("\n")}
      // Problems Solved: ${problem_solved
      //   .map((problem) => `- ${problem.value}`)
      //   .join("\n")}

      // Here are some examples of what the analysis should look like:
      // Examples of Target Audiences USPs, Benefits and Problems Solved for www.legora.com:

      // USPs for Partners at Large B2B Law Firms in Sweden.

      // - USP 1 for Partners at Large B2B Law Firms in Sweden:
      //   AI-Powered Tabular Review Built for Bulk Due Diligence
      //   In firms like Mannheimer Swartling, which handles hundreds of M&A, financing, and corporate
      //   transactions annually, manually reviewing contract batches of 50+ agreements can take days of
      //   billable associate time. Legora's tabular review converts dozens of documents into sortable data
      //   tables in minutes. For Partners, this means faster quality control, earlier issue spotting, and the
      //   ability to commit to more deals under flat-fee pricing - helping to align with today's Swedish
      //   client expectations around speed and value.

      // - USP 2 for Partners at Large B2B Law Firms in Sweden:
      //   Endorsement by Peers in Scandinavian and European Tier-One Firms
      //   Seeing top firms like Bird & Bird and Goodwin using Legora gives Swedish Partners confidence
      //   in the platform. These firms' embrace of the tool - especially in tech and energy deal flows -
      //   serves as a de-risking signal. Partners in Stockholm can thus position Legora not as a
      //   speculative investment, but as peer-validated infrastructure that enhances existing strategic
      //   legal services.

      // - USP 3 for Partners at Large B2B Law Firms in Sweden:
      //   Word Add-In That Honors Swedish Legal Drafting Habits
      //   Swedish Partners - steeped in chapter-and-verse drafting in Word—hesitate to switch platforms.
      //   Legora's design philosophy respects this habit by providing AI tools within the familiar Word
      //   interface. Contract review remains immersive and natural, with added structure. This design
      //   insight removes training friction and protects workflow continuity, enabling adoption without
      //   disruption or fatigue.

      // - USP 4 for Partners at Large B2B Law Firms in Sweden:
      //   Product-Led Development with Practicing Lawyer Input
      //   Legora's platform was shaped through direct collaboration with practicing lawyers - not just
      //   software engineers. This practitioner-led design resonates with Swedish Partners who often
      //   lament generic automation solutions that overlook real-world drafting nuance. Legora's layout
      //   and feature set are therefore not just convenient but strategically aligned with Swedish legal
      //   drafting patterns and compliance workflows.

      // - USP 5 for Partners at Large B2B Law Firms in Sweden:
      //   Strong Financial Backing and Enterprise-Grade Data Security
      //   Legora's $675M valuation and leadership backing from heavyweights like ICONIQ Growth and
      //   General Catalyst matter considerably in Sweden's risk-averse corporate counseling culture.
      //   Partners evaluating legal tech want assurance of longevity and compliance standards -
      //   especially GDPR readiness. Legora's investor pedigree and data security infrastructure meet
      //   those expectations, addressing concerns about vendor stability and data residency.

      // Benefits for Partners at Large B2B Law Firms in Sweden.

      // - Benefits 1 for Partners at Large B2B Law Firms in Sweden:
      //   Dramatically Increased Billable Capacity in High-Volume Practice Areas
      //   Partners running M&A or finance deal teams traditionally allocate associate or paralegal hours
      //   to comb through agreements. By reducing review times by up to 90%, Legora effectively
      //   multiplies capacity without hire. This means Partners can open more matter slots per team,
      //   supporting aggressive growth targets and offering clients faster, smarter, and more efficient
      //   services.

      // - Benefits 2 for Partners at Large B2B Law Firms in Sweden:
      //   Strengthened Client Retention Through Speed and Insight
      //   In Sweden's competitive legal market, delivering at speed—especially under fixed-fee billing - is
      //   a powerful value driver. Legora enables Partners to surface clause-by-clause comparisons and
      //   risk insights faster, positioning their firms as innovative leaders. This not only wows clients but
      //   improves retention rates and promotes higher follow-on deal flow, particularly in sectors like
      //   fintech, energy, and infrastructure.

      // - Benefits 3 for Partners at Large B2B Law Firms in Sweden:
      //   Margin Preservation Amidst Rising Internal Costs
      //   Swedish firms are increasingly pressured to cover associate and overhead costs within flat-fee
      //   arrangements. By automating time-draining tasks such as renewal tracking or indemnity
      //   comparison, Legora reduces internal cost leakage. Partners can therefore maintain healthy
      //   margins without having to sacrifice investment in strategic client guidance.

      // - Benefits 4 for Partners at Large B2B Law Firms in Sweden:
      //   Internal Consistency & Quality Assurance Across Teams
      //   Large B2B firms often juggle multiple practice groups—each with different drafting conventions.
      //   Legora introduces structure by aggregating clause-level data across all practice areas, enabling
      //   Partners to ensure uniformity. This is invaluable during partner-level quality reviews and
      //   supports brand consistency, even when junior lawyers come and go.

      // - Benefits 5 for Partners at Large B2B Law Firms in Sweden:
      //   Competitive Differentiation Through Tech-Led Services
      //   When RFPs come in, Partners positioned as tech-forward advisors secure an edge. Legora's
      //   structured outputs - like searchable datasets and analytics-driven review summaries—enable
      //   Partners to responsively service clients with complex compliance or due-diligence needs. By
      //   marketing their capability to track clauses at scale, firms can elevate perceived value above
      //   traditional law firm approaches.

      // Problems Solved for Partners at Large B2B Law Firms in Sweden

      // - Problems Solved 1 for Partners at Large B2B Law Firms in Sweden:
      //   Manual Bottlenecks That Delay High-Volume Transactions
      //   Swedish B2B law firms like Mannheimer Swartling, Vinge, and Delphi handle hundreds of
      //   contracts per week across their M&A, real estate, and banking practices. A single M&A
      //   transaction might include 30 - 100 supplier, customer, or IP agreements that need to be
      //   reviewed before closing. Traditionally, this review is done manually by junior associates or
      //   secondees, often under immense time pressure. These bottlenecks regularly slow down
      //   closings, increase stress on teams, and introduce risk due to human error. Legora eliminates
      //   these frictions by automating clause-by-clause review across large batches of contracts in
      //   minutes. This allows partners to finalize transactions faster, meet aggressive closing schedules,
      //   and reduce dependency on stretched associate resources - without compromising legal
      //   precision.

      // - Problems Solved 2 for Partners at Large B2B Law Firms in Sweden:
      //   Margin Compression from Fixed-Fee Work and Client Demands for Efficiency
      //   The Swedish legal market is shifting toward fixed-fee or capped-fee pricing, particularly in
      //   transactional and regulatory advisory work. Clients - especially in sectors like real estate,
      //   renewables, and PE - expect speed, predictability, and transparency. For partners, this creates a
      //   growing tension: delivering excellent work at scale without escalating internal costs. Without
      //   automation, profitability often suffers, especially when junior time cannot be billed. Legora
      //   directly addresses this by significantly reducing the hours needed for contract review and
      //   making deliverables more standardized and scalable. Partners can thus commit to flat fees with
      //   confidence, safeguard their margins, and reinvest freed-up capacity into new client matters.

      // - Problems Solved 3 for Partners at Large B2B Law Firms in Sweden:
      //   Inconsistency and Risk in Clause Language Across Teams
      //   In large Swedish law firms with 200+ lawyers, it's common for the same clause - like
      //   indemnities, exclusivity, or termination rights - to appear with slight but significant differences
      //   across deals. This inconsistency can lead to internal friction during partner review, difficulty
      //   reusing templates, and even client dissatisfaction when clauses don't align with prior advice.
      //   Legora solves this by structuring all reviewed clauses into a unified, searchable format, allowing
      //   partners to quickly compare wording across deals, teams, and historical matters. This enables
      //   more consistent advice across the firm, easier creation of standard templates, and faster
      //   onboarding of new team members or laterals - all while reducing exposure to drafting risk.

      // - Problems Solved 4 for Partners at Large B2B Law Firms in Sweden:
      //   Cultural Resistance and Low Adoption of Legal Tech
      //   Despite years of interest in legal tech, many Swedish firms still struggle with actual adoption.
      //   Partners face internal pushback from senior associates and support staff who are already
      //   stretched and reluctant to learn new systems. Failed rollouts create skepticism and damage
      //   innovation credibility within the firm. Legora avoids these pitfalls by embedding itself directly into
      //   Microsoft Word - the one tool lawyers already live in. No context-switching, no steep learning
      //   curve. Associates can begin reviewing in a smarter, structured format from day one, while
      //   partners can extract value from the tool without needing major behavior change. This allows law
      //   firm innovation efforts to actually land and stick - something Swedish firms have historically
      //   struggled with.

      // - Problems Solved 5 for Partners at Large B2B Law Firms in Sweden:
      //   Limited Visibility into Key Contract Data Puts Clients and Firms at Risk
      //   Even the most sophisticated law firms in Sweden rely heavily on unstructured contract data -
      //   stored in PDFs, tracked in Excel, or remembered ad hoc by specific team members. This
      //   fragmented visibility becomes a real risk during audits, disputes, or regulatory inspections,
      //   where clients expect firms to instantly surface key dates, obligations, or risk exposures. Missed
      //   renewal deadlines or buried exclusivity clauses can damage client relationships and erode trust.
      //   Legora prevents this by turning every contract into a structured dataset, complete with
      //   searchable clauses, filtering, and export functionality. Partners can instantly access the
      //   information they need, across hundreds of documents, and present it to clients or regulators
      //   within minutes. This transforms the firm from a reactive service provider into a proactive
      //   strategic partner - especially important in industries facing rising compliance expectations,
      //   like ESG, financial services, and energy.

      //   Use the content above to create the analysis and also search the web for latest information about the company to add relevant points.
      //   Escape all string values to comply with JSON format (no unescaped line breaks or illegal characters).
      //   Add more usps, problems, and benefits if there are more, the example is just for reference.
      //   Avoid markdown or explanations. Format strictly as a single valid JSON object.
      //   Ensure the text is returned in the language code: ${language}.
      //   Respond with only the JSON object such as:
      //   {
      //     "role": "Example Role",
      //     "industry": "Example Industry",
      //     "country": "Country",
      //     "reasoning": "Example Reasoning",
      //     "insights": {
      //       "usps": [
      //         {
      //           "title": "USP 1: Example USP",
      //           "description": "Example USP Description",
      //           "source": "https://example.com"
      //         },
      //       ],
      //       "problems": [
      //         {
      //           "title": "Problem 1: Example Problem",
      //           "description": "Example Problem Description",
      //           "source": "https://example.com"
      //         },
      //       ],
      //       "benefits": [
      //         {
      //           "title": "Benefit 1: Example Benefit",
      //           "description": "Example Benefit Description",
      //           "source": "https://example.com"
      //         },
      //       ]
      //     }
      //   }
      // `;

      const prompt = `
        You are a senior industry analyst who deeply understands the role, industry, and country
        of the target audience.
        Write an in-depth analysis of how ${companyWebsite}'s previously identified USPs, Benefits,
        and Problems Solved directly affect this specific target audience. Write as if you've spent 5+
        years in this role—you know their KPIs, operational pressures, and how they evaluate new tools.

        MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
        FOR EXAMPLE IF THE LANGUAGE CODE IS "sv" THEN THE TEXT SHOULD BE RETURNED IN SWEDISH AND IF THE LANGUAGE CODE IS "en" THEN THE TEXT SHOULD BE RETURNED IN ENGLISH AND SO ON.

        Structure:
        - Three sections: USPs, Benefits, Problems Solved.
        - For each section, write five consulting-grade paragraphs (not bullet points). Each
        paragraph should:
        - Focus on one USP/benefit/problem.
        - Explain how it impacts the target audience's daily workflow, business model, or
        strategic goals.
        - Include real-world context: local industry trends, regulations, role KPIs, operational pain
        points.
        - Length: ~150 words. Treat each as a mini-analysis suitable for a consulting deck.
        - Use at least 3 quantifiable data points (benchmarks, costs, adoption rates, time
        savings).
        - Compare against current alternatives (competitors, legacy tools).
        - Tailor it to the decision-makers in this audience (e.g., how HR Directors in Spain
        make staffing decisions vs. Operations Managers in Germany).
        - Use verifiable sources (company cases, public stats, reports). If direct data is
        missing, benchmark against industry standards—never make up numbers.
        - Keep it fact-based, practical, and locally relevant.

        Tone: Write as if handing this to someone in that role—they should recognize their challenges in
        what you're describing.
        Target Audience: ${role} at ${industry} in ${country}
        Base your analysis on the following:
        ${unique_selling_points.map((usp) => `- ${usp.value}`).join("\n")}
        ${benefits.map((benefit) => `- ${benefit.value}`).join("\n")}
        ${problem_solved.map((problem) => `- ${problem.value}`).join("\n")}

        Examples of Deep USPs for www.jobandtalent.com:

        USPs for Supply Chain Managers in Spanish Manufacturing in Spain

        1. AI-Driven Job Matching Prevents Costly Line Disruptions
        For supply chain managers in Spanish manufacturing, unplanned labor shortages can halt
        production lines—costing €30,000-€50,000 per hour in lost output (PwC Manufacturing
        Insights 2024). These disruptions are particularly damaging in automotive and industrial plants,
        where delays ripple across complex supplier networks. Job&Talent's AI-powered matching
        eliminates reliance on traditional resumes and manual screening, cutting time-to-fill by up to
        70% compared to agencies like Adecco or Randstad. This matters in Spain, where line-worker
        turnover exceeds 32% (INE 2024) and shift coverage must remain stable to meet stringent
        delivery schedules. Unlike transactional staffing firms, Job&Talent's algorithm continuously
        evaluates candidate availability, skill sets, and proximity, dynamically matching pre-vetted
        workers to open roles. This reduces emergency overtime, prevents last-minute staffing crises,
        and helps managers maintain on-time delivery KPIs. For high-volume production lines, this
        technology turns reactive firefighting into proactive workforce planning—allowing supply chain
        teams to protect throughput and profitability even under volatile labor conditions.

        2. Vast Network of Pre-Vetted Workers Ensures Workforce Continuity
        Spanish manufacturing is increasingly exposed to demand fluctuations of 15-20%
        month-to-month in sectors like automotive and electronics (ANFAC 2024). For supply chain
        managers at companies like SEAT, Gestamp, or Mondragon, this creates constant workforce
        uncertainty across stamping, assembly, and packaging functions—roles where delays cascade
        into supplier penalties and customer dissatisfaction. Job&Talent's network of over 2,500
        corporate partnerships and continuously refreshed worker pool offers coverage that traditional
        agencies cannot match. Its scale allows managers to tap into regionally distributed pools of
        qualified, pre-screened workers at short notice, ensuring continuity across multiple sites. This
        is especially critical in Spain's competitive automotive supply chain, where any staffing shortfall
        can derail just-in-time production schedules. By combining this workforce depth with real-time
        visibility into worker availability, Job&Talent ensures managers can maintain operational
        stability even during unplanned demand swings. This consistency reduces dependency on
        subcontractors, lowers labor cost volatility, and ultimately strengthens supply chain resilience.

        3. Integrated Compliance Features Reduce Administrative Burden
        Compliance with Spain's strict labor laws—most notably the Registro de Jornada requirement
        for daily working-time tracking—places significant administrative pressure on supply chain
        managers. Manual timekeeping and fragmented systems not only drain resources but also
        increase exposure to fines, which can reach €187,000 per violation (Spanish Labor
        Inspectorate 2024). Job&Talent's platform integrates geo-located clock-ins, automated
        attendance tracking, and audit-ready logs, reducing compliance administration by up to 25%
        (Job&Talent Case Study 2024). This automation simplifies adherence to collective bargaining
        agreements and reporting obligations during labor inspections, freeing managers from hours of
        paperwork each week. Importantly, these records are centrally accessible across multi-site
        operations, giving leadership full visibility into labor allocation and ensuring regulatory
        consistency. For supply chain teams, this transforms compliance from a reactive, time-intensive
        task into a streamlined process—allowing them to redirect focus toward throughput
        optimization, supplier coordination, and production planning instead of bureaucratic
        oversight.

        4. Rapid Scaling Capability for Peak Demand
        Spanish manufacturers frequently face labor surges tied to automotive model launches,
        seasonal production cycles, and pre-holiday spikes, often requiring hundreds of additional
        workers at short notice. Traditionally, onboarding large cohorts can take 2-4 weeks using
        agency partners, forcing managers into costly overtime or delaying production schedules.
        Job&Talent's AI recruiter Clara can onboard hundreds of pre-vetted workers in under 48
        hours, as reported by its European logistics clients. This speed allows supply chain leaders to
        respond dynamically to demand fluctuations, aligning labor capacity with real-time
        production needs. Clara automates candidate sourcing, pre-screening, and scheduling, reducing
        the burden on in-house HR teams and ensuring that new hires are ready to work almost
        immediately. For manufacturers competing in just-in-time environments, this scalability
        prevents costly production bottlenecks and protects customer delivery commitments. It
        effectively gives supply chain managers the workforce elasticity needed to thrive in Spain's
        volatile manufacturing landscape.

        5: Financial Stability Enables Continuous Innovation
        Job&Talent's $1.1 billion in funding and $2.35 billion valuation provide enterprise
        manufacturers with confidence that they are partnering with a long-term, financially secure
        provider. Unlike smaller regional staffing firms, Job&Talent reinvests this capital into continuous
        platform innovation, ensuring clients benefit from cutting-edge AI capabilities, predictive
        analytics, and compliance automation. For supply chain managers overseeing multi-site
        operations in Spain, this financial backing translates into reduced vendor risk—knowing the
        platform will scale with their needs and remain resilient in volatile economic conditions. It also
        enables Job&Talent to expand its regional worker networks, deepening labor availability in
        key industrial hubs like Catalonia and the Basque Country. By choosing a well-capitalized
        partner, manufacturers mitigate the operational risks of service disruption while gaining access
        to a workforce solution designed for future-proofing complex, high-volume supply chains.
        This combination of financial strength and innovation positions Job&Talent as a strategic
        partner, not just a transactional vendor.

        Examples of Deep Problems Solved for www.jobandtalent.com:

        Problems Solved for Supply Chain Managers in Spanish Manufacturing in Spain

        1. Labor Shortages Disrupting Production Lines
        Spanish manufacturing suffers from chronic labor shortages, with line-worker turnover at
        32% and vacancy rates surpassing 12% in key sub-sectors (INE 2024). For supply chain
        managers at companies like SEAT, Gestamp, and Mondragon, this creates a persistent risk of
        production delays and missed delivery commitments—costing €30,000-€50,000 per hour in
        downtime (PwC Manufacturing Insights 2024). Traditional staffing agencies often can't provide
        pre-vetted candidates fast enough to prevent these disruptions. Job&Talent solves this by
        providing on-demand access to a continuously updated pool of qualified workers across
        multiple regions in Spain. This capability allows managers to backfill roles within hours
        instead of days, maintaining production continuity and protecting customer delivery timelines.
        By combining AI-driven matching with local market expertise, Job&Talent turns labor planning
        into a strategic lever for avoiding line stoppages—directly safeguarding revenue and operational
        performance.

        2. Long Hiring Cycles for Seasonal and Peak Demand
        Scaling labor for production peaks—such as model launches, holiday runs, or supplier
        ramp-ups—typically takes 2-4 weeks when working with traditional staffing agencies, leaving
        managers reliant on costly overtime or subcontracting. These emergency measures inflate costs
        by 15-25% during peak months (McKinsey Operations 2024) and strain permanent staff.
        Job&Talent's AI recruiter Clara can onboard hundreds of pre-screened workers in under 48
        hours, cutting time-to-hire by 70-80%. This means supply chain leaders can quickly align
        workforce capacity with production plans, avoiding bottlenecks that derail schedules. The
        platform also allows proactive planning for demand surges by building talent pipelines in
        advance, a critical advantage in Spain's fast-moving automotive and industrial sectors. This
        rapid, scalable hiring approach gives manufacturers the agility to meet production spikes without
        sacrificing quality or profitability, making Job&Talent a preferred partner over slower, legacy
        staffing providers.

        3. Compliance Complexity with Spanish Labor Regulations
        Navigating Spain's strict labor framework—including the Registro de Jornada daily
        working-time law and collective bargaining agreements—places heavy administrative burdens
        on supply chain teams. Non-compliance can result in fines of up to €187,000 per infraction
        (Spanish Labor Inspectorate 2024), as well as reputational damage. Many manufacturers still
        rely on manual timesheets or fragmented systems, increasing the risk of errors. Job&Talent
        addresses this by embedding geo-located clock-ins, automated attendance tracking, and
        audit-ready reporting into its platform. This automation reduces compliance-related
        administrative hours by up to 25% (Job&Talent Case Study 2024) and simplifies labor
        inspections. For supply chain managers, it means less time spent on paperwork and more time
        optimizing throughput. It also provides executives with greater visibility into labor patterns,
        ensuring strategic compliance across multiple sites. In a sector under increasing regulatory
        scrutiny, Job&Talent transforms compliance from a reactive burden into a streamlined, proactive
        process.
        
        4. Unreliable Workforce Engagement and Retention
        High absenteeism and turnover erode operational consistency, destabilizing production lines
        and inflating costs through constant retraining. In Spanish manufacturing, absenteeism
        averages 6.2%, well above the EU average, and disengaged workers are twice as likely to
        leave within 90 days (Eurofound 2024). This churn forces supply chain managers to spend
        more time firefighting labor gaps rather than focusing on strategic initiatives. Job&Talent
        mitigates this by incorporating gamified milestones, real-time performance tracking, and
        incentive programs through its mobile platform—features that have reduced mid-assignment
        dropouts by 15-20% for European clients. These engagement tools help managers build more
        stable and motivated teams, lowering onboarding costs and improving workforce reliability. For
        plants that depend on synchronized assembly processes, this level of retention directly
        translates to higher productivity and fewer production delays, giving Job&Talent a measurable
        edge over transactional staffing agencies.

        5. Fragmented Vendor Management Across Sites
        Large manufacturers often manage multiple staffing vendors across facilities, creating
        procurement inefficiencies, inconsistent workforce quality, and limited visibility into labor
        performance. This vendor fragmentation adds 10-15% to procurement overhead (BCG
        Procurement Report 2024) and complicates compliance monitoring across regions. Job&Talent
        solves this by operating in 10+ countries and offering centralized dashboards for multi-site
        workforce management, enabling supply chain leaders to consolidate staffing under a single,
        scalable provider. This standardization reduces administrative complexity, improves workforce
        quality control, and streamlines reporting for audits and internal KPIs. For Spanish
        manufacturing plants operating across Catalonia, Basque Country, and beyond, this unified
        model provides a single source of truth for labor planning—improving transparency while
        cutting procurement costs. By replacing a patchwork of agencies with one platform, Job&Talent
        delivers both operational and financial efficiencies, making it an indispensable partner for
        large-scale manufacturing operations.

        Examples of Deep Benefits for www.jobandtalent.com:

        Benefits for Supply Chain Managers in Spanish Manufacturing in Spain

        1. Higher Workforce Reliability and Reduced Disruption
        For Spanish manufacturers, even brief production interruptions can cascade into costly
        supply-chain disruptions. Job&Talent delivers up to a 29% increase in workforce productivity
        (Job&Talent Case Study 2024) by combining AI-driven matching with continuous worker
        performance tracking, ensuring plants are staffed with qualified and engaged employees. For
        supply chain managers at companies like Gestamp or SEAT, this means fewer missed shifts,
        faster replacements for absent workers, and reduced dependency on overtime. The result:
        higher operational reliability across assembly lines and warehouse operations. Unlike traditional
        staffing agencies, which offer little post-placement engagement, Job&Talent monitors
        performance in real time, empowering managers with actionable insights. This creates a more
        predictable labor pipeline, allowing supply chain teams to focus on strategic planning instead of
        firefighting. The platform effectively turns staffing into a competitive advantage by stabilizing one
        of the most volatile elements of manufacturing operations: the hourly workforce.

        2. Accelerated Hiring and Onboarding at Scale
        Scaling production during demand surges often forces Spanish manufacturers into 2-4 week
        hiring cycles, which compromise flexibility and inflate costs. Job&Talent reduces this to as little
        as 48 hours, leveraging its AI recruiter Clara to source, interview, and onboard workers at
        unprecedented speed (Job&Talent Product Documentation 2024). For supply chain leaders, this
        translates into the ability to quickly ramp labor capacity without overstretching permanent
        teams or resorting to costly subcontractors. By automating large portions of the recruitment
        process, the platform enables supply chain managers to staff for high-volume projects like new
        model launches or pre-holiday runs without the administrative burden of manual recruitment.
        The resulting agility is a competitive differentiator in Spain's fast-paced manufacturing sector,
        where speed and precision determine profitability. Job&Talent's approach doesn't just fill
        roles—it creates a flexible, ready-to-deploy workforce that can be scaled up or down as
        production needs shift.

        3. Streamlined Compliance and Reduced Administrative Load
        Spanish labor regulations—particularly the Registro de Jornada law—require precise time
        tracking and documentation for all employees, a process that drains supply chain teams of
        valuable time. Job&Talent automates these workflows with geo-located clock-ins, integrated
        attendance logs, and audit-ready reporting, reducing administrative hours by up to 25%
        (Job&Talent Case Study 2024). For manufacturing supply chain managers, this means fewer
        compliance headaches and less risk of costly infractions, which can reach €187,000 per
        violation (Spanish Labor Inspectorate 2024). By centralizing compliance oversight across
        multiple sites, Job&Talent not only simplifies labor law adherence but also equips managers with
        real-time insights into staffing patterns. This visibility helps them make informed workforce
        planning decisions, freeing up time for higher-value tasks such as improving throughput or
        negotiating supplier terms. It transforms compliance from a reactive pain point into a strategic
        enabler of operational excellence.

        4. Lower Staffing Costs Through Vendor Consolidation
        Managing a patchwork of regional staffing agencies drives up procurement overhead by
        10-15% and creates inconsistent workforce quality (BCG Procurement Report 2024).
        Job&Talent offers a single, enterprise-grade solution for staffing across multiple Spanish
        regions, from Catalonia to Basque Country. This consolidation allows supply chain managers to
        negotiate better rates, streamline vendor oversight, and achieve 15-25% cost reductions
        through automation and efficiency (Job&Talent Efficiency Study 2024). By replacing fragmented
        agency relationships with one platform, managers gain a unified view of workforce performance
        across sites, reducing procurement complexity and improving forecasting accuracy. Beyond the
        direct financial savings, this centralization creates operational consistency, ensuring
        standardized onboarding, compliance, and performance tracking across all facilities. For supply
        chain leaders under pressure to control costs while meeting production targets, Job&Talent
        delivers both economic and operational value, positioning itself as a strategic partner rather than
        a transactional vendor.

        5. Enhanced Agility for Competitive Advantage
        In Spain's manufacturing sector—especially in automotive and industrial equipment, where
        output can swing 15-20% month-to-month (ANFAC 2024)—the ability to respond quickly to
        demand changes determines market competitiveness. Job&Talent enables supply chain
        managers to maintain workforce agility, scaling up or down based on real-time production
        needs. This flexibility allows manufacturers to capitalize on market opportunities (e.g.,
        ramping production for export orders) without overcommitting to permanent labor contracts.
        Unlike legacy agencies, which operate reactively, Job&Talent's predictive workforce planning
        tools help managers anticipate needs before bottlenecks emerge. This agility reduces
        operational risk and creates a buffer against supply-chain volatility. For supply chain managers,
        it means fewer missed opportunities, improved delivery performance, and the ability to adapt
        staffing strategies in line with broader business goals. In a highly competitive EU market,
        Job&Talent gives manufacturers a structural advantage in speed, efficiency, and
        responsiveness.

        Use the content above to create the analysis and also search the web for latest information about the company to add relevant points.
        Escape all string values to comply with JSON format (no unescaped line breaks or illegal characters).
        Add more usps, problems, and benefits if there are more, the example is just for reference.
        Avoid markdown or explanations. Format strictly as a single valid JSON object.
        Ensure the text is returned in the language code: ${language}.
        Ensure that strings in the json object have proper quotes and are not escaped.

        IMPORTANT: USE THE JSON FORMAT BELOW AND MAKE SURE ITS A VALID JSON OBJECT.
        IMPORTANT: Make sure that the link for sources are not shown in the actual analysis description but put in the source array.
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
                "source": ["https://example.com"]
              },
            ],
            "problems": [
              {
                "title": "Problem 1: Example Problem",
                "description": "Example Problem Description",
                "source": ["https://example.com"]
              },
            ],
            "benefits": [
              {
                "title": "Benefit 1: Example Benefit",
                "description": "Example Benefit Description",
                "source": ["https://example.com"]
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

      console.log("Successfully analyzed content with OpenAI");
      const analysis = openAiResponse.output_text;
      console.log("OpenAI analysis:", analysis);
      console.log(
        "OpenAI analysis preview:",
        analysis.substring(0, analysis.length)
      );
      console.log(
        "OpenAI analysis end:",
        analysis.substring(analysis.length - 500)
      );

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

      // Check if the JSON is properly closed
      if (!cleanAnalysis.endsWith("}")) {
        console.log("JSON appears to be truncated, attempting to fix...");
        // Find the last complete object by looking for the last closing brace
        const lastBraceIndex = cleanAnalysis.lastIndexOf("}");
        if (lastBraceIndex > 0) {
          cleanAnalysis = cleanAnalysis.substring(0, lastBraceIndex + 1);
          console.log("Truncated JSON to last complete object");
        }
      }

      // Fix incomplete source arrays
      cleanAnalysis = cleanAnalysis.replace(
        /"source":\s*\[([^\]]*?)(?:\n|$)/g,
        '"source": [$1]'
      );

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
