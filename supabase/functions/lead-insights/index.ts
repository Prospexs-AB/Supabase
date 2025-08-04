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
    const { campaign_id, lead } = await req.json();

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

    let { step_10_result } = progressData;
    if (!step_10_result) {
      step_10_result = [];
    }

    const leadExists = step_10_result.find(
      (savedLead) => savedLead.full_name === lead.full_name
    );

    if (leadExists) {
      return new Response(JSON.stringify(leadExists), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const { data: jobData, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("campaign_id", campaign_id);

    const jobExists = jobData.find(
      (job) => job.progress_data.full_name === lead.full_name
    );
    console.log("jobExists", jobExists);

    if (jobExists) {
      return new Response(
        JSON.stringify({
          message: `Job already exists for ${lead.full_name}`,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    const { company_name: lead_company_name, linkedin_url: lead_linkedin_url } =
      lead;
    const {
      step_1_result: { language },
      step_3_result,
    } = progressData;

    // STEP 1: Get details with challenges
    console.log("===== Step 1: Getting details with challenges =====");

    const challengesPrompt = `
      What is the most recent publicly available annual revenue of ${lead_company_name}, in USD?
      If exact revenue is not available, provide a credible estimate based on available data (e.g.
      funding size, employee count, ARR benchmarks, analyst estimates, or reported growth metrics).
      Specify:
      - The source of the information (e.g. company report, Crunchbase, press article)
      - The fiscal year or date the revenue figure applies to
      If no reliable revenue estimate is available, clearly say “Unknown.”

      What is the most recent publicly available number of employees at ${lead_company_name}?
      If the exact number is not available, provide a credible estimate based on public data (e.g.
      LinkedIn, company website, funding size, growth stage, or press coverage).
      If no reliable estimate is available, clearly say “Unknown.”

      What is the primary industry of ${lead_company_name}?
      Return the answer as a single word, such as:
      “Software”, “Retail”, “Construction”, “Logistics”, “Healthcare”, etc.
      Use the company's core business model or primary source of revenue to determine the correct
      industry.
      If the company spans multiple verticals, choose the dominant one based on product focus or
      market positioning.
      Do not include any explanations—just return the one-word industry.

      You are a senior industry analyst at a top global consultancy.
      Prospexs (Our company) has already analyzed the user's service and knows what problems they solve.
      Now, your task is to identify 4 strategic business challenges currently faced by ${lead_company_name}
      that are directly relevant to the user's offering—specifically, challenges that this user
      is well-positioned to solve.
      Focus on real, data-backed challenges related to:
      - Growth bottlenecks
      - Inefficient processes
      - Poor targeting, personalization, or outreach
      - Missed revenue due to low conversion or weak messaging
      - Regulatory, marketing, or go-to-market pressure
      - Missed automation opportunities or lack of insight
      Prioritize problems that can be clearly tied back to the user's value proposition, based on what
      Prospexs already knows about their product.

      If no specific challenge are found, use relevant industry benchmarks for their sector and
      geography.

      If company-specific goals are not available, apply industry-standard challenges and metrics
      relevant to the company's sector and geography.
      Each challenge should be written as a short, but indepth paragraph (6-8 sentences) with
      business context, urgency, and clarity.
      Do not use bullet points. Do not explain the user's product. Just describe the challenges.
      Your tone should be sharp, insightful, and analytical—like a strategy consultant writing a client
      briefing.
      Important: Only use information that is explicitly available in the input data.
      Do not assume, invent, or guess details about the lead, their company, or their situation.
      If no relevant information is found, state that clearly.
      You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
      and always label them clearly as general context, not lead-specific insight.

      Example Detected Challenges for www.teamtailor.com:

      Challenge 1: Market Saturation & Competitive Differentiation
      The applicant tracking system (ATS) market is booming—expected to exceed $3.2 billion
      globally by 2026—but it's also increasingly crowded. Teamtailor faces mounting pressure from
      both legacy players like SAP SuccessFactors and modern challengers like Greenhouse, Lever,
      and Ashby. Many competitors now bundle ATS with CRM, onboarding, and even candidate
      sourcing. For Teamtailor to maintain momentum, especially outside the Nordics, it needs to keep
      sharpening its value prop and pushing innovation to avoid being seen as "just another ATS".

      Challenge 2: Scaling to Enterprise Demands
      While Teamtailor has nailed the SMB and mid-market segments, climbing upmarket brings a
      new set of expectations. Larger clients expect advanced automation, custom workflows, robust
      integrations (e.g., native Gmail, Teams, deep API access), and security certifications like SOC 2
      or ISO 27001. Reviews on platforms like G2 often praise its UX but point out limitations in
      flexibility, reporting granularity, and enterprise readiness—signaling potential churn risks as
      customers grow.

      Challenge 3: The AI Talent Tech Race
      AI investment in HR tech topped $2 billion globally in 2023, with tools now automating
      everything from candidate scoring to job ad optimization. Teamtailor has introduced some
      automation, but compared to players like HireVue or Paradox, it risks falling behind in the AI
      arms race. To stay relevant, it must move beyond workflow automation and invest in predictive
      analytics, candidate intelligence, and AI-driven personalization to improve hiring outcomes.

      Challenge 4: Cross-Border Compliance & Data Integrity
      Expanding into 90+ countries introduces serious regulatory complexity—from GDPR in the EU
      to Brazil's LGPD and emerging frameworks like the EU AI Act. Clients increasingly demand
      transparency around data storage, automated decision-making, and candidate profiling. For a
      product that hinges on trust and personal data, failing to meet these standards could slow
      adoption or block entry into new markets. Being proactive on compliance is no longer
      optional—it's a moat.

      Example Detected Challenges for www.remote.com:

      Challenge 1: Global Compliance Complexity & Regulatory Risk
      Remote.com operates in over 180 countries, acting as the legal Employer of Record (EOR) on
      behalf of its clients. This model brings substantial regulatory complexity, as each market has its
      own evolving labor laws, tax frameworks, benefits requirements, and worker protections. As
      governments crack down on misclassification and tighten remote work compliance—especially
      post-COVID—Remote must constantly update its localized knowledge base, contracts, and
      infrastructure to avoid fines or operational disruption. Recent movements like the EU's AI Act
      and country-specific employment reforms (e.g., Brazil's tightening contractor laws) only intensify
      the need for real-time legal agility. Failing to adapt quickly enough could jeopardize Remote's
      promise of full compliance and introduce reputational or legal risk for both itself and its clients.

      Challenge 2: Surging Competition in the Global Payroll & EOR Market
      While Remote was an early innovator in the EOR space, the market has quickly flooded with
      aggressive, well-funded players like Deel (valued at $12B+), Rippling, Oyster, and Papaya
      Global. Many are bundling adjacent services such as equipment provisioning, visa support, and
      equity plan management—raising the bar for what clients expect. In Q1 2024 alone, VC funding
      for global HR tech surpassed $2.5B, much of it going to platforms in direct competition. To
      maintain relevance and market share, Remote must continue investing in product breadth,
      infrastructure, and pricing transparency—especially as enterprise buyers increasingly demand
      fully integrated HRIS + payroll ecosystems.

      Challenge 3: Worker Classification & Contractor Risk Exposure
      One of the biggest threats in Remote's business model is the misclassification of contractors vs.
      employees. Lawsuits against companies like Uber and DoorDash have spotlighted the financial
      and legal implications of getting this wrong. While Remote's platform includes contractor
      management, the company must work harder to educate customers on proper
      classification—and provide robust tools to enforce it. The recent release of “Contractor
      Management Plus” is a step in the right direction, but as governments step up enforcement,
      Remote will need to ensure every client follows the letter of the law in each jurisdiction. Even
      indirect noncompliance could erode trust and create liabilities.

      Challenge 4: Pressure to Scale While Preserving Customer Experience
      Following a $300M Series C at a $3B+ valuation, Remote is under significant pressure to scale
      both revenue and operations without compromising product quality or customer success. With
      clients ranging from startups to multinationals like GitLab and Toyota, expectations around
      uptime, support SLAs, integrations, and localization are extremely high. As the company grows,
      balancing automation with human service becomes tricky—especially in edge cases like
      benefits claims, offboarding, or localized payroll errors. Without scalable systems and top-tier
      account management, churn risks increase—particularly among enterprise clients who expect
      flawless delivery across geographies.

      Example Detected Challenges for www.zimpler.com:

      Challenge 1: Regulatory Scrutiny and Legal Challenges
      In 2023, the Swedish Gambling Authority (Spelinspektionen) ordered Zimpler to cease providing
      services to unlicensed gambling operators, threatening a fine of SEK 25 million. Zimpler
      contested the order, and the Swedish Court of Appeal ultimately ruled in its favor, citing
      ambiguities in the Gambling Act regarding what constitutes targeting Swedish consumers.
      Despite this legal victory, the case highlighted the complexities fintech companies face in
      ensuring compliance across different jurisdictions, especially when operating in sectors like
      iGaming that are subject to stringent regulations.

      Challenge 2: Anti-Money Laundering (AML) Compliance
      Operating in high-risk sectors necessitates robust AML measures. Zimpler has emphasized its
      commitment to AML compliance, implementing procedures such as customer identification,
      transaction monitoring, and risk assessments. However, the dynamic nature of financial crimes
      and the need to balance security with user experience present ongoing challenges. Ensuring
      effective AML compliance is crucial for maintaining trust and meeting regulatory expectations.

      Challenge 3: Intensifying Competition in the A2A Payments Space
      The A2A payments market is experiencing significant growth, projected to reach a global market
      size of nearly $850 billion by 2026. Zimpler faces competition from established players like
      Trustly and emerging fintech startups. To differentiate itself, Zimpler has pursued strategic
      partnerships, such as its collaboration with Swish, Sweden's most used payment app, to
      enhance its service offerings and expand its market reach.

      Challenge 4: Challenges in International Expansion
      Zimpler's expansion into markets like Brazil introduces new complexities, including adapting to
      local payment infrastructures and regulatory environments. For instance, integrating with Brazil's
      Pix payment system requires navigating unique compliance requirements and consumer
      behaviors. Successfully localizing services while maintaining operational efficiency is essential
      for sustainable growth in diverse markets.

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      Return the answers in the following JSON format:
      {
        "company_name": "Acme Inc.",
        "revenue": "1000000",
        "employees": "100",
        "industry": "Software",
        "challenges": [
          {
            "title": "the title of the challenge will be here",
            "description": "Description of challenge 1"
          },
        ]
      }
    `;

    const detailsWithChallengesOutput = await openai.responses.create({
      model: "gpt-4.1",
      tools: [{ type: "web_search_preview" }],
      input: challengesPrompt,
    });

    let cleanDetailsWithChallengesOutput =
      detailsWithChallengesOutput.output_text.trim();
    if (cleanDetailsWithChallengesOutput.startsWith("```json")) {
      cleanDetailsWithChallengesOutput = cleanDetailsWithChallengesOutput
        .replace(/^```json\s*/, "")
        .replace(/\s*```$/, "");
    } else if (cleanDetailsWithChallengesOutput.startsWith("```")) {
      cleanDetailsWithChallengesOutput = cleanDetailsWithChallengesOutput
        .replace(/^```\s*/, "")
        .replace(/\s*```$/, "");
    }

    const parsedDetailsWithChallengesOutput = JSON.parse(
      cleanDetailsWithChallengesOutput
    );

    const result = {
      businessInsights: {
        detail: {
          company_name: parsedDetailsWithChallengesOutput.company_name,
          revenue: parsedDetailsWithChallengesOutput.revenue,
          employees: parsedDetailsWithChallengesOutput.employees,
          industry: parsedDetailsWithChallengesOutput.industry,
        },
      },
      personInsights: {},
    };

    // STEP 2: Get solutions for challenges
    console.log("===== Step 2: Getting solutions for challenges =====");

    const solutionsPrompt = `
      You are a senior solutions strategist at a top global consultancy.
      Prospexs has already analyzed two things:

      1. The user's company, including its product/service, value proposition, and problems it
      solves, these include the user company benefits, problems solved, and unique selling points:
        ${JSON.stringify(step_3_result)}

      2. The lead company's specific strategic challenges:
        ${JSON.stringify(parsedDetailsWithChallengesOutput.challenges)}

      Your task is to generate 4 tailored solutions for each identified challenge that show how the
      user's offering directly addresses the lead company's challenges.
      Each solution should be written as a standalone paragraph (3-5 sentences) and should:
      - Clearly link the lead's pain point to the user's strength
      - Use business-relevant language (e.g. "reduce compliance risk," "increase lead conversion,"
      "cut onboarding time")
      - Hint at what value or outcome this solution could unlock for the lead
      Do not explain or describe the user's company—only focus on how their product solves the
      lead's problems.
      If no specific solutions are found, use relevant industry benchmarks for your sector and
      geography.
      If company-specific solutions are not available, apply industry-standard solutions and metrics
      relevant to the company's sector and geography.
      Your tone should be persuasive, strategic, and practical—like you're building the foundation for
      a business case or outbound conversation.
      Assume that company-specific data and product context are already known to the system. You
      do not need to request that information again.
      Important: Only use information that is explicitly available in the input data.
      Do not assume, invent, or guess details about the lead, their company, or their situation.
      If no relevant information is found, state that clearly.

      You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
      and always label them clearly as general context, not lead-specific insight.

      Example Solutions for www.teamtailor.com:

      Example Solution 1: Repositioning in a Saturated Market by Monetizing Differentiation
      In a crowded ATS space, Teamtailor could leverage Stripe's flexible billing infrastructure to
      experiment with usage-based or value-based pricing tied to real client outcomes - such as
      number of hires made or workflows automated. By shifting away from flat licenses, Teamtailor
      could better align perceived value with cost, making their offer more attractive to startups and
      SMBs with variable hiring cycles. This could also allow for new packaging strategies based on
      verticals or use cases—unlocking monetization paths that differentiate them from feature-similar
      competitors.

      Example Solution 2: Scaling Into Enterprise with Modular, Localized Billing Infrastructure
      As Teamtailor moves upmarket and expands globally, the complexity of handling procurement
      processes, invoicing requirements, tax compliance, and localized payment preferences
      increases. Stripe's enterprise-grade billing, tax automation, and invoicing tools would allow
      Teamtailor to tailor commercial models to large, international clients—whether that means
      quote-based pricing, ACH payments in the US, or SEPA in the EU. This infrastructure removes
      friction in the buying process, speeding up deal velocity and helping enterprise teams say "yes"
      faster.

      Example Solutions for www.remote.com:

      Example Solution 1: Simplifying Global Compliance Through Automated Tax
      Infrastructure
      Remote.com operates across 180+ countries, navigating a complex patchwork of local tax,
      billing, and payment regulations. Stripe Tax and Stripe Billing could remove a huge operational
      burden by automating sales tax, VAT, and invoice compliance in over 40 countries—helping
      Remote offer compliant, localized billing models at scale. This lets Remote focus its legal and
      product teams on labor regulation and EOR complexity rather than financial compliance,
      reducing risk and freeing up resources in hyper-growth markets.

      Example Solution 2: Staying Competitive by Streamlining Onboarding and Monetization
      Remote faces growing pressure from Deel, Papaya Global, and Rippling, all of which are
      aggressively expanding product ecosystems. Stripe's Identity and Connect products could help
      Remote onboard businesses and contractors faster and more securely, while offering flexible
      monetization options—whether charging usage-based fees, custom enterprise tiers, or
      cross-selling payroll add-ons. This lets Remote match competitive pace without rebuilding
      infrastructure, while improving activation speed and lifetime value.

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.

      Ensure that the matching challenge and solution are in the same object.
      Return the answers in the following JSON format:
      [
        {
          "problemTitle": "Problem 1",
          "problemDescription": "Description of problem 1",
          "solutions": [
            {
              "solutionTitle": "Solution 1 for challenge 1",
              "solutionDescription": "Description of solution 1 for challenge 1",
            },
            {
              "solutionTitle": "Solution 2 for challenge 1",
              "solutionDescription": "Description of solution 2 for challenge 1"
            }
          ]
        },
        {
          "problemTitle": "Problem 2",
          "problemDescription": "Description of problem 2",
          "solutions": [
            {
              "solutionTitle": "Solution 1 for challenge 2",
              "solutionDescription": "Description of solution 1 for challenge 2",
            },
            {
              "solutionTitle": "Solution 2 for challenge 2",
              "solutionDescription": "Description of solution 2 for challenge 2"
            }
          ]
        },
      ]
    `;

    const solutionsWithChallengesOutput = await openai.responses.create({
      model: "gpt-4.1",
      tools: [{ type: "web_search_preview" }],
      input: solutionsPrompt,
    });

    let cleanSolutionsWithChallengesOutput =
      solutionsWithChallengesOutput.output_text.trim();
    if (cleanSolutionsWithChallengesOutput.startsWith("```json")) {
      cleanSolutionsWithChallengesOutput = cleanSolutionsWithChallengesOutput
        .replace(/^```json\s*/, "")
        .replace(/\s*```$/, "");
    } else if (cleanDetailsWithChallengesOutput.startsWith("```")) {
      cleanDetailsWithChallengesOutput = cleanDetailsWithChallengesOutput
        .replace(/^```\s*/, "")
        .replace(/\s*```$/, "");
    }

    const parsedSolutionsWithChallengesOutput = JSON.parse(
      cleanSolutionsWithChallengesOutput
    );

    // STEP 3: Get impacts of solutions
    console.log("===== Step 3: Getting impacts of solutions =====");

    const impactsOfSolutions = [];
    const impactPromises = parsedSolutionsWithChallengesOutput.map(
      async (challenge) => {
        const impactsOfSolutionsPrompt = `
        You are a senior business impact analyst at a top-tier consultancy.

        Your task is to articulate the business impact of solving ${
          challenge.problemTitle
        } for ${lead_company_name}, using
        company-specific goals when available, or falling back on relevant industry benchmarks when
        needed.

        Given the following context:
        Company: ${lead_company_name}
        Challenge title: ${challenge.problemTitle}
        Challenge description: ${challenge.problemDescription}
        Solutions (there are 4): ${challenge.solutions.map(
          (solution) =>
            `Title: ${solution.solutionTitle} Description: ${solution.solutionDescription}`
        )}
        
        IMPORTANT! RETURN THE RESPONSE IN A JSON FORMAT USING THE FORMAT BELOW. DO NOT INCLUDE ANY EXPLANATORY TEXT, MARKDOWN FORMATTING, OR ADDITIONAL CONTENT OUTSIDE THE JSON STRUCTURE.

        Step 1: Search for public company goals or KPIs from sources like their website, annual
        reports, press releases, or social media. Focus on areas like:
        ● Growth
        ● Cost reduction
        ● Innovation
        ● Operational efficiency
        ● Sustainability
        ● Hiring or retention
        ● International expansion
        If no specific goals are found, use relevant industry benchmarks for their sector and
        geography.
        If company-specific goals are not available, apply industry-standard goals and metrics relevant
        to the company's sector and geography.

        Step 2: Write a clear and specific impact statement (4-6 sentences) for each solution explaining
        how solving the challenge with the given solution helps the company within the array of objects in the JSON format provided below:
        ● Achieve one or more of its goals faster, more efficiently, or at lower cost
        ● Improve a specific KPI (e.g. time-to-hire, CAC, churn rate, operational margin)
        ● Strengthen competitive advantage, innovation capacity, or resilience
        When possible, quantify the impact using real-world data or benchmarks (e.g. “could reduce
        onboarding time by 30%” or “increase revenue per rep by 25%”).
        Keep the tone confident and executive-level.

        Do not repeat or explain the solution again - focus entirely on the outcome.
        Important: Only use information that is explicitly available in the input data.
        Do not assume, invent, or guess details about the lead, their company, or their situation.
        If no relevant information is found, state that clearly.
        You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
        and always label them clearly as general context, not lead-specific insight.

        Example Detected Impact for www.teamtailor.com:

        Example Impact 1: Monetizing Differentiation in a Saturated Market
        By adopting Stripe's flexible billing and pricing infrastructure, Teamtailor could shift from flat-rate
        models to usage- or outcome-based billing—better aligning pricing with customer-perceived
        value. This enables pricing experiments that match specific segments (e.g. hyper-growth
        startups vs. slower-moving corporates), reducing churn and improving average revenue per
        account (ARPA). Industry benchmarks show that value-based pricing can boost SaaS revenue
        by 20-40%. For a platform competing in a saturated ATS market, this change could help unlock
        new monetization paths and increase customer lifetime value—without adding product
        complexity.

        Example Impact 2: Unlocking Enterprise Sales Through Frictionless Finance
        Infrastructure
        As Teamtailor expands into the enterprise segment, Stripe's localized invoicing, tax compliance,
        and flexible payment rails (ACH, SEPA, etc.) remove friction from procurement and finance
        flows that often delay large deals. This enables faster deal closure, aligns with enterprise
        procurement standards, and reduces sales cycle length—critical for B2B SaaS businesses
        aiming to land larger contracts. Accelerating time-to-close by even 15-20% could meaningfully
        boost quarterly recurring revenue (QRR) and help Teamtailor compete more effectively against
        enterprise-focused vendors like SAP SuccessFactors.

        Example Detected Impact for www.remote.com:

        Example Impact 1: Reducing Compliance Risk and Manual Overhead in Global Billing
        By implementing Stripe Tax and Billing, Remote.com can automate global invoicing and tax
        compliance across 180+ countries, significantly reducing operational risk and the burden on
        legal and finance teams. This infrastructure would allow Remote to support complex tax rules
        (like VAT, GST, and reverse charges) at scale—while minimizing manual reconciliation and
        compliance errors. For a global EOR provider, streamlining financial compliance not only
        improves audit readiness but also accelerates expansion into regulated or complex markets.
        Industry benchmarks suggest companies using automated tax solutions reduce
        compliance-related errors and costs by up to 30%, freeing up internal teams to focus on
        higher-value work.

        Example Impact 2: Improving Customer Acquisition and Conversion Velocity
        Stripe's Identity and Connect tools can help Remote onboard businesses and contractors faster
        and with fewer drop-offs, which is crucial for winning enterprise deals and scaling B2B platform
        usage. Reducing KYC friction and payment setup complexity translates to faster time-to-value
        for clients—directly improving Remote's onboarding KPIs and reducing sales cycle times. In
        highly competitive segments (with Deel, Rippling, and Oyster aggressively expanding), faster
        onboarding could become a deciding factor. Industry data shows that reducing user onboarding
        friction can increase conversion by up to 35% and improve first-month retention—giving Remote
        a competitive edge.

        IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.

        IMPORTANT: You must return ONLY valid JSON in the exact format specified below. Do not include any explanatory text, markdown formatting, or additional content outside the JSON structure.
        Return the answers in the following JSON format:
        {
          "title": "The problem title will be here",
          "description": "Description of problem",
          "solutions": [
            {
              "solutionTitle": "Solution 1 for challenge 1",
              "solutionDescription": "Description of solution 1 for challenge 1",
              "impactTitle": "Impact for challenge 1",
              "impactDescription": "Description of impact of solution 1 for challenge 1"
            },
            {
              "solutionTitle": "Solution 2 for challenge 1",
              "solutionDescription": "Description of solution 2 for challenge 1",
              "impactTitle": "Impact for challenge 1",
              "impactDescription": "Description of impact of solution 2 for challenge 1"
            }
          ]
        }
      `;

        const impactsOfSolutionsOutput = await openai.responses.create({
          model: "gpt-4.1",
          tools: [{ type: "web_search_preview" }],
          input: impactsOfSolutionsPrompt,
        });

        let cleanImpactsOfSolutionsOutput =
          impactsOfSolutionsOutput.output_text.trim();
        if (cleanImpactsOfSolutionsOutput.startsWith("```json")) {
          cleanImpactsOfSolutionsOutput = cleanImpactsOfSolutionsOutput
            .replace(/^```json\s*/, "")
            .replace(/\s*```$/, "");
        } else if (cleanImpactsOfSolutionsOutput.startsWith("```")) {
          cleanImpactsOfSolutionsOutput = cleanImpactsOfSolutionsOutput
            .replace(/^```\s*/, "")
            .replace(/\s*```$/, "");
        }

        const parsedImpactsOfSolutionsOutput = JSON.parse(
          cleanImpactsOfSolutionsOutput
        );

        impactsOfSolutions.push(parsedImpactsOfSolutionsOutput);
      }
    );

    await Promise.all(impactPromises);

    // STEP 4: Get objection handling
    console.log("===== Step 4: Getting objection handling =====");

    const challengePromises = impactsOfSolutions.map(async (challenge) => {
      const solutionPromises = challenge.solutions.map(async (solution) => {
        const objectionHandlingPrompt = `
          You are a senior B2B strategist at a top consultancy, preparing a sales or success team for high-stakes outreach.
          Prospexs has already identified:
          - The lead company's current business challenges: ${challenge.description}.
          - The user's proposed solution: ${solution.solutionDescription}.
          - The projected impact of implementing that solution: ${solution.impactDescription}.

          Now, your task is to anticipate 4 realistic objections the lead company might raise—even when the impact is strong.

          For each objection, follow this format:
          1. Objection
          2. Why it's valid
          3. How to work around it

          IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.

          Return ONLY valid JSON like this:
          {
            "solutionTitle": "Solution for challenge",
            "solutionDescription": "Description here",
            "impactTitle": "Impact for challenge",
            "impactDescription": "Impact description here",
            "objectionHandling": [
              {
                "objection": "Objection text here",
                "whyItsValid": "Why it's valid explanation",
                "howToWorkAroundIt": "How to work around it"
              }
            ]
          }
        `;

        const response = await openai.responses.create({
          model: "gpt-4.1",
          tools: [{ type: "web_search_preview" }],
          input: objectionHandlingPrompt,
        });

        let text = response.output_text.trim();
        console.log("objection handling text", text);
        console.log(
          "objection handling text end:",
          text.substring(text.length - 500)
        );

        if (text.startsWith("```json")) {
          text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");
        } else if (text.startsWith("```")) {
          text = text.replace(/^```\s*/, "").replace(/\s*```$/, "");
        }

        return JSON.parse(text);
      });

      const results = await Promise.all(solutionPromises);
      challenge.solutions = results;
      return challenge;
    });

    await Promise.all(challengePromises);

    result.businessInsights.challengesWithSolutions = impactsOfSolutions;

    await supabase.from("jobs").insert({
      campaign_id: campaign_id,
      status: "queued",
      progress_data: { ...lead, insights: result },
    });

    console.log(`Adding job to database:`, lead.full_name);

    return new Response(
      JSON.stringify({
        message: "Successfully generated business insights",
        data: { ...lead, insights: result },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/lead-insights' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
