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
      (savedLead) =>
        savedLead.unformatted_full_name === lead.full_name
    );

    // if (leadExists) {
    //   return new Response(JSON.stringify(leadExists), {
    //     headers: { ...corsHeaders, "Content-Type": "application/json" },
    //     status: 200,
    //   });
    // }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    const { company_name: lead_company_name, linkedin_url: lead_linkedin_url } = lead;
    const { step_3_result } = progressData;

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

      Example Solution 3: Preparing for AI Feature Monetization Without Friction
      If Teamtailor is investing in AI functionality, Stripe makes it easy to test and charge for new
      features - either as add-ons, bundled into new tiers, or billed per-usage (e.g. “AI-assisted
      candidate screening”). Stripe's flexible pricing engine lets Teamtailor adapt pricing based on
      usage data and feedback without overhauling backend systems. This helps the product and
      GTM teams move faster, monetize innovation sooner, and reduce time-to-revenue from new
      features.

      Example Solution 4: De-Risking Expansion into New Markets with Global Payments
      Compliance
      Teamtailor is expanding into 90+ countries, which brings significant operational complexity in
      terms of handling local currencies, regulations, and tax requirements. Stripe’s global payments
      and tax stack simplifies this, letting Teamtailor accept payments in 135+ currencies, generate
      compliant invoices, and automatically handle VAT and sales tax. That means the finance team
      spends less time untangling tax issues—and more time supporting strategic growth.

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

      Example Solution 3: Managing Contractor Risk with Real-Time Payments & Controls
      One of Remote's biggest liabilities is contractor misclassification and payroll mishandling. Stripe
      Treasury and Instant Payouts can help Remote build a compliant, embedded payout experience
      with real-time visibility and control over disbursements. With programmatic wallet infrastructure
      and built-in KYC/AML, Remote could offer global contractors faster access to funds while
      ensuring payout flows meet local financial regulations—mitigating risk and improving the user
      experience.

      Example Solution 4: Scaling Internationally Without Friction in Finance Ops
      As Remote continues expanding into new markets, its finance stack must handle multiple
      currencies, languages, payment methods, and partner billing flows. Stripe supports payments in
      135+ currencies, local payment methods (e.g. SEPA, Boleto, ACH), and financial reporting
      across subsidiaries. This allows Remote to enter new countries without needing custom-built
      finance logic for each one—ensuring the ops and GTM teams can scale smoothly alongside
      product.

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

        Example Impact 3: Monetizing AI Add-Ons Without Backend Friction
        As Teamtailor builds AI capabilities (e.g. for candidate ranking or smart scheduling), Stripe
        enables the monetization of those features via add-ons or usage-based pricing—without
        engineering bottlenecks. This flexibility allows the product team to test go-to-market strategies
        (freemium vs. paid AI tiers) without overhauling infrastructure. Benchmarks suggest companies
        that successfully monetize AI functionality can grow ARPA by 10-30% within 12 months. For
        Teamtailor, this could mean turning innovation into a scalable revenue engine instead of a cost
        center.

        Example Impact 4: Scaling Internationally with Built-In Global Payment Compliance
        With customers in over 90 countries, Teamtailor faces the ongoing challenge of managing taxes,
        currency conversions, and localized payment methods. Stripe's global payments and tax
        automation stack helps ensure fast, compliant billing across regions—cutting down legal risk,
        reducing overhead, and speeding up collections. This directly supports Teamtailor's goal of
        expanding its footprint in Europe and beyond, while also ensuring its finance ops scale with
        minimal overhead. Reducing regional friction could shorten time-to-revenue in new markets by
        several months—critical in hyper-competitive SaaS growth cycles.

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

        Example Impact 3: Lowering Contractor Payout Risk While Increasing Speed
        By integrating Stripe Treasury and Instant Payouts, Remote can offer global contractors
        near-instant access to earned wages through localized, compliant disbursement flows. This
        adds value for contractors—many of whom prioritize payment reliability and speed—while
        helping Remote stay ahead of misclassification risks and legal scrutiny. Providing real-time
        payout transparency also improves customer trust and reduces the likelihood of support
        escalations related to payroll. The result: a more resilient and scalable contractor infrastructure
        that supports both user retention and compliance.

        Example Impact 4: Accelerating Market Expansion Without Adding Finance Headcount
        Stripe's global payment rails and multi-currency support allow Remote to accept and process
        payments in 135+ currencies, offer localized payment methods (e.g. ACH, SEPA, PIX), and
        generate regionally compliant invoices. This removes the need for custom finance logic and
        tooling each time Remote enters a new country. As Remote targets rapid global expansion,
        Stripe becomes a force multiplier—enabling entry into new markets with minimal overhead.
        Reducing localization costs by even 40-50% per market can significantly compress the timeline
        for international growth and make global ARR targets more attainable.

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

          Return ONLY valid JSON like this:
          {
            "solutionTitle": "Solution for challenge",
            "solutionDescription": "...",
            "impactTitle": "Impact for challenge",
            "impactDescription": "...",
            "objectionHandling": [
              {
                "objection": "...",
                "whyItsValid": "...",
                "howToWorkAroundIt": "..."
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

    // const conversationStarterPrompt = `
    //   You are a senior B2B strategist at a top-tier consultancy preparing for high-level outreach or
    //   networking with a senior stakeholder (VP, C-level, or strategic buyer).
    //   Prospexs has already analyzed the target company's:
    //   - Product or service
    //   - Position in the market
    //   - Business model and GTM strategy
    //   - Challenges, growth areas, and recent developments

    //   These are the challenges that Prospexs has identified from the target company in JSON format:
    //   ${JSON.stringify(
    //     result.businessInsights.challengesWithSolutions,
    //     null,
    //     2
    //   )}

    //   Your task is to generate 3-4 insight-driven conversation starters, each rooted in recent
    //   company news, product announcements, market moves, or strategic updates.
    //   For each one:
    //   - Start with a short title (4-6 words max)
    //   - Then write a 2-3 sentence conversation starter
    //   Each question should:
    //   - Reference a specific public update, launch, or trend relevant to the company
    //   - Tie that update to a broader strategic question or point of curiosity
    //   - Be framed in a smart, consultative, and respectful tone
    //   - Invite thoughtful conversation—not yes/no answers or surface-level reactions
    //   Avoid generic or cliché questions. Prioritize context, timeliness, and relevance.
    //   Important: Only use information that is explicitly available in the input data.
    //   Do not assume, invent, or guess details about the lead, their company, or their situation.
    //   If no relevant information is found, state that clearly.
    //   You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
    //   and always label them clearly as general context, not lead-specific insight.

    //   IMPORTANT! RETURN THE RESPONSE IN A JSON FORMAT USING THE FORMAT BELOW. DO NOT INCLUDE ANY EXPLANATORY TEXT, MARKDOWN FORMATTING, OR ADDITIONAL CONTENT OUTSIDE THE JSON STRUCTURE.

    //   Example Conversation Starters for www.teamtailor.com

    //   Example Conversation Starters 1: Doubling Down on Skills-Based Hiring - Teamtailor recently
    //   introduced skill-based filtering, giving recruiters more control in shortlisting candidates based on
    //   specific competencies rather than just resumes. As more companies shift toward
    //   competency-first hiring to tackle role misalignment and reduce bias, how are you positioning this
    //   feature to serve both tech-savvy scaleups and more traditional hiring teams who may still rely on
    //   gut feel or CVs?

    //   Example Conversation Starters 2: Cleaning Up Candidate Data at Scale - The new
    //   LinkedIn-based duplicate detection feature is a smart move for teams juggling high volumes of
    //   applications across multiple roles. In what ways are you planning to use this to improve data
    //   quality and reduce recruiter time spent on administrative filtering—especially as your mid-market
    //   and enterprise clients demand faster time-to-hire with cleaner pipelines?

    //   Example Conversation Starters 3: Hiring Workflows Are Getting Smarter—But Are Hiring
    //   Managers Ready? - Teamtailor's recent updates hint at more powerful, automated
    //   workflows—including more advanced filters, evaluations, and automated actions. Are you
    //   seeing friction from hiring managers who may find the increasing complexity overwhelming?
    //   And how are you thinking about education or UI design to keep adoption high as the product
    //   becomes more intelligent?

    //   Example Conversation Starters 4: AI vs. Human-Centric Hiring - There's been a lot of hype
    //   around AI-driven hiring, but Teamtailor has always stood out for human-centered UX and strong
    //   employer brand tools. As more competitors lean into 'AI-first' messaging, how do you see that
    //   narrative fitting into Teamtailor's growth story - especially in markets that still value
    //   personalization and candidate experience?

    //   Example Conversation Starters for www.stripe.com

    //   Example Conversation Starters 1: AI Foundation Model for Payment Intelligence - Stripe
    //   recently unveiled its own AI foundation model, trained on over 100 billion data points from global
    //   payment flows. It's already being deployed to improve fraud detection, risk modeling, and
    //   checkout personalization. For a platform with Stripe's scale, this represents a shift from reactive
    //   tooling to proactive, intelligent infrastructure. How is Stripe thinking about expanding the impact
    //   of this model—not just in fraud prevention, but also in things like conversion optimization,
    //   dynamic pricing, or dispute resolution?

    //   Example Conversation Starters 2: Stablecoin Financial Accounts and Treasury
    //   Transformation - With its new stablecoin financial accounts, Stripe now lets businesses hold
    //   balances in digital dollars (USDC), use them to pay vendors, and eventually integrate them into
    //   their own financial stack. The service is live in 101 countries—positioning Stripe not just as a
    //   payments provider but as a programmable treasury layer for modern internet businesses. What
    //   kind of feedback is Stripe seeing from SaaS or marketplace platforms that are trying to reduce
    //   FX fees, shorten settlement times, or simplify cross-border reconciliation using this feature?

    //   Example Conversation Starters 3: Payment Orchestration as a Strategic Wedge - Stripe's
    //   new Orchestration feature allows merchants to route payments through multiple providers within
    //   the Stripe environment—without rebuilding internal logic. This is a big move in a market where
    //   enterprises increasingly want multi-PSP setups for reliability, optimization, and global flexibility.
    //   Is Stripe seeing this as a way to deepen enterprise lock-in, or more as an open architecture
    //   move to win over companies that historically avoided single-provider risk?

    //   Example Conversation Starters 4: Checkout Optimization Through Real-Time AI
    //   Personalization - Stripe has upgraded its Optimized Checkout Suite with AI-driven logic that
    //   dynamically personalizes the checkout flow per user, based on thousands of micro-signals (e.g.
    //   geography, device, past behavior). Early testing has shown conversion lifts of over 2%-a big
    //   delta at enterprise scale. As Stripe continues to lean into data-led infrastructure, what are the
    //   downstream implications for merchants who might want to own this layer themselves? Is there a
    //   play here for Stripe to become the de facto optimization layer, not just the processor?

    //   IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
    //   IMPORTANT: Return the answers in the following JSON format:
    //   [
    //     {
    //       "title": "The title of the conversation starter will be here",
    //       "description": "Description of the conversation starter",
    //     },
    //     {
    //       "title": "The title of the conversation starter will be here",
    //       "description": "Description of the conversation starter",
    //     }
    //   ]
    // `;

    const {
      step_2_result: { company_name },
    } = progressData;

    // const commonalitiesPrompt = `
    //   You are a senior B2B strategist at a top global consultancy.

    //   Prospexs has already analyzed the business models, value propositions, and go-to-market
    //   strategies of both companies listed below.

    //   Your task is to identify 4 deep, strategic similarities between the two companies. These
    //   similarities should help the user ${company_name} build trust, relevance, or credibility when reaching
    //   out to ${lead_company_name}.

    //   Focus on real, non-obvious business commonalities, such as:
    //   - Monetization model (e.g. usage-based, seat-based)
    //   - Customer acquisition strategy (e.g. PLG, direct sales, ecosystem-led)
    //   - Target buyer persona (e.g. devs, recruiters, CFOs)
    //   - Technical architecture (API-first, ecosystem integrations, modularity)
    //   - Internationalization strategy
    //   - Unit economics (e.g. high NRR, expansion revenue, LTV/CAC logic)

    //   Use data or market logic where possible (e.g. based on company size, funding stage, product
    //   motion, reported NRR benchmarks, etc.).

    //   Format each similarity as a short, insight-rich paragraph. Write with the tone of a strategist or
    //   investor—not a marketer.
    //   Do not include generic similarities like "both are SaaS companies." Focus on what's strategically
    //   interesting or commercially relevant.

    //   Important: Only use information that is explicitly available in the input data.
    //   Do not assume, invent, or guess details about the lead, their company, or their situation.
    //   If no relevant information is found, state that clearly.
    //   You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
    //   and always label them clearly as general context, not lead-specific insight.

    //   IMPORTANT! RETURN THE RESPONSE IN A JSON FORMAT USING THE FORMAT BELOW. DO NOT INCLUDE ANY EXPLANATORY TEXT, MARKDOWN FORMATTING, OR ADDITIONAL CONTENT OUTSIDE THE JSON STRUCTURE.

    //   Example Detected Similarities Between www.teamtailor.com and www.stripe.com:

    //   Example Similarities 1: ExamUsage-Based, Scalable SaaS Models Designed for High LTV
    //   Stripe and Teamtailor both monetize through usage-aligned pricing models—Stripe via
    //   transaction volume and modular APIs, Teamtailor via seats, brand modules, and usage tiers.
    //   This results in high NRR (net revenue retention)—a critical SaaS metric. Stripe's NRR has been
    //   estimated north of 125%, while Teamtailor's customer retention and upsell motion (across
    //   10,000+ companies) reflects similar unit economics: land small, expand over time. Both are
    //   structured to grow with their customers' success.

    //   Example Similarities 2: Dominant in PLG-Friendly Buyer Personas
    //   Stripe sells to developers and product teams. Teamtailor sells to in-house recruiters and
    //   employer branding leads. These are bottom-up buyers, historically underserved by legacy
    //   systems like Oracle or SAP. According to OpenView's PLG benchmark report, 61% of
    //   top-performing SaaS companies use a PLG strategy to land SMB and mid-market accounts
    //   before moving into enterprise—a playbook both Stripe and Teamtailor have mastered.

    //   Example Similarities 3: International Growth With Localized Infrastructure
    //   Stripe supports payments in 135+ currencies across 45+ countries with localized compliance,
    //   tax, and payout logic. Teamtailor operates in 90+ countries, offering localized career pages,
    //   language support, and hiring workflows. Both face the same challenge: enabling regional depth
    //   at global scale. Their international expansions rely not on HQ-based assumptions but on
    //   platform customization at the local level—a rare operational capability in SaaS.

    //   Example Similarities 4: API-Centric, Extensible Platforms Built for Ecosystem Scale
    //   Stripe's API-first approach led to 3rd-party adoption across 100K+ startups and platforms (e.g.
    //   Shopify, Amazon, GitHub). Teamtailor, while not an API company, has built one of the most
    //   integrated ATS platforms, with over 100 plug-and-play integrations including Slack, Zapier,
    //   LinkedIn, and scheduling tools. Both companies treat extensibility as a strategic moat—reducing
    //   churn by embedding deeper into the workflows of their users and ecosystems.

    //   Example Detected Similarities Between www.remote.com and www.stripe.com:

    //   Example Similarities 1: Global Compliance Infrastructure at Scale
    //   Stripe and Remote.com both operate as regulatory infrastructure companies in their respective
    //   verticals. Stripe manages complex global financial compliance across 135+ currencies and 45+
    //   countries, including KYC, AML, tax automation, and payment licensing. Remote operates legal
    //   entities in 180+ countries, handling employment law, payroll tax compliance, and contractor
    //   classification. Both companies reduce regulatory overhead and legal exposure for fast-scaling
    //   businesses, allowing them to enter new markets in days instead of months. This shared
    //   positioning as a "compliance shield" makes them part of the modern international expansion
    //   stack.

    //   Example Similarities 2: API-Centric Growth Engines Driving Embedded Revenue
    //   Stripe generates a significant portion of its revenue via API-led integrations with platforms like
    //   Shopify, Amazon, and Notion—powering embedded finance flows. Similarly, Remote is building
    //   embedded HR infrastructure, with public partnerships and integrations (e.g. Greenhouse,
    //   BambooHR) and a growing API product to let platforms offer payroll and compliance as a
    //   service. Both companies are transitioning from SaaS to "platform revenue" models, where third
    //   parties generate and own the customer relationship, while Stripe/Remote operate quietly
    //   underneath. This shift supports exponential distribution and monetization without linear sales
    //   headcount growth.

    //   Example Similarities 3: Usage-Based Monetization With Exceptional Net Revenue
    //   Retention
    //   Stripe's NRR has been reported to exceed 125-130%, largely due to transactional pricing.
    //   Remote uses a similar model, charging per employee or contractor managed, with expansion
    //   into value-added services like benefits, stock options, and local compliance advisory. In markets
    //   with high CAC and long sales cycles, usage-based expansion is a moat—it boosts LTV,
    //   minimizes churn, and aligns growth with customer success. Stripe and Remote are both
    //   designed to win land-and-expand motions in tech-forward B2B segments.

    //   Example Similarities 4: Dominating in Decentralized, Post-COVID Workflows
    //   Post-2020, the rise of remote work and international commerce made Stripe and Remote
    //   indispensable. Stripe's adoption skyrocketed as businesses went digital—facilitating payments
    //   for Shopify, Amazon, Notion, and 100k+ others. Remote grew by over 10x between 2020 and
    //   2022, driven by the need to hire talent globally without establishing foreign subsidiaries. Both
    //   companies are winning in the decentralized operations economy—where business is global
    //   from day one, and infrastructure needs to be borderless, automated, and compliant.

    //   IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
    //   IMPORTANT: Return the answers in the following JSON format:
    //   [
    //     {
    //       "title": "The title of the similarity will be here",
    //       "description": "Description of the similarity",
    //     },
    //     {
    //       "title": "The title of the similarity will be here",
    //       "description": "Description of the similarity",
    //     }
    //   ]
    // `;

    // const insightsPrompt = `
    //   You are a senior business analyst at a top-tier consultancy.

    //   Your task is to generate 4 recent and insight-rich updates about ${lead_company_name}, focused on product development, strategic direction, or key company moves.

    //   Each insight should:
    //   - Be based on publicly available sources (e.g. blog posts, press releases, product pages, news articles, update logs)
    //   - Be 3-5 sentences long
    //   - Include business context and explain why the update matters strategically (not just what happened)
    //   - Avoid speculation—only use confirmed developments or directly attributable content
    //   - End with a reliable source link (company blog or press, not random third parties)

    //   Do not include generic company overviews or old funding news. Focus on product launches,
    //   feature updates, platform changes, new capabilities, or go-to-market shifts from the last 6-12
    //   months.

    //   Important: Only use information that is explicitly available in the input data.
    //   Do not assume, invent, or guess details about the lead, their company, or their situation.
    //   If no relevant information is found, state that clearly.
    //   You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
    //   and always label them clearly as general context, not lead-specific insight.

    //   Example Insights About X for www.stripe.com

    //   Example Insights about X 1: Stripe's AI Foundation Model Enhances Payment Intelligence - In
    //   April 2025, Stripe announced the deployment of a proprietary AI foundation model trained on
    //   over 100 billion payment events. This model, already integrated into Radar, has improved fraud
    //   detection rates by 64% for card-testing attacks. More significantly, it signals Stripe's broader
    //   move toward intelligent infrastructure—not just for security, but also for optimizing checkout
    //   flows, predicting conversion behavior, and powering real-time decisions across the platform.
    //   Stripe is positioning this model not as a standalone AI feature, but as a core enabler of every
    //   part of the payment lifecycle.

    //   Example Insights about X 2: Stablecoin Financial Accounts Expand Global Reach - Stripe
    //   launched Stablecoin Financial Accounts, giving businesses the ability to hold and move money
    //   in USDC across 100+ markets. This unlocks faster global transfers, hedges against local
    //   currency volatility, and reduces dependence on traditional banking rails. Especially for platforms
    //   operating in emerging markets or with remote contractors, this could become a key advantage
    //   in cost control and payment flexibility. The move deepens Stripe's position as a global treasury
    //   layer—not just a processor.

    //   Example Insights about X 3: Stripe Orchestration Introduces Multi-PSP Routing Flexibility -
    //   The new Stripe Orchestration product gives merchants the ability to route payments between
    //   multiple providers within the Stripe environment, including fallback logic and smart retries. For
    //   global businesses, this solves a growing need for redundancy and optimization without requiring
    //   deep engineering investments. It's also a strategic play by Stripe to stay embedded even in
    //   setups that traditionally favored PSP diversification.

    //   Example Insights about X 4: Optimized Checkout Suite Delivers Real-Time Personalization
    //   with AI - Stripe's checkout product has been enhanced with AI that adjusts checkout layout,
    //   payment methods, and UI components in real time—based on location, device, past behavior,
    //   and over 100 contextual signals. Early results show significant uplifts in conversion, particularly
    //   for mobile and international traffic. This pushes Stripe deeper into the merchant-side
    //   optimization stack—blurring the lines between infrastructure and customer experience.

    //   Example Insights About X for www.teamtailor.com

    //   Example Insights about X 1: AI-Driven Co-pilot Enhances Recruitment Efficiency -
    //   Teamtailor's introduction of the AI-powered Co-pilot marks a significant advancement in
    //   streamlining recruitment processes. Co-pilot assists recruiters by automating tasks such as
    //   drafting job advertisements, summarizing resumes, and suggesting interview questions tailored
    //   to specific roles. This integration of AI not only accelerates the hiring process but also ensures
    //   consistency and reduces manual errors, allowing HR teams to focus more on strategic
    //   decision-making and candidate engagement.

    //   Example Insights about X 2: Comprehensive Onboarding Module Bridges Pre-Hire to Day
    //   One - Recognizing the importance of a seamless transition from candidate to employee,
    //   Teamtailor has launched a robust onboarding feature. This module enables HR teams to
    //   automate tasks, assign responsibilities across departments, and centralize essential documents
    //   and communications. By customizing onboarding templates for different roles or departments,
    //   organizations can ensure a consistent and welcoming experience for new hires, thereby
    //   improving retention rates and employee satisfaction from the outset.

    //   Example Insights about X 3: Enhanced Skills-Based Hiring with Integrated Evaluation Tools -
    //   In response to the growing emphasis on competency-based recruitment, Teamtailor has
    //   upgraded its evaluation features. The platform now offers a unified evaluation system that
    //   combines scorecards, interview kits, and job match scores, allowing recruiters to assess
    //   candidates based on specific skills and traits. This structured approach minimizes unconscious
    //   bias and ensures that hiring decisions are grounded in objective criteria, aligning with best
    //   practices in modern talent acquisition.

    //   Example Insights about X 4: Dynamic Application Forms Improve Candidate Experience -
    //   Teamtailor has introduced conditional questions in application forms, enabling a more
    //   personalized and efficient candidate experience. By tailoring subsequent questions based on
    //   previous answers, applicants are presented with relevant queries, reducing redundancy and
    //   form fatigue. This dynamic approach not only enhances the user experience but also ensures
    //   that recruiters gather pertinent information, streamlining the screening process and improving
    //   the quality of applicant data.

    //   IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
    //   IMPORTANT: Return the answers in the following JSON format:
    //   [
    //     {
    //       "title": "The title of the insight will be here",
    //       "description": "Description of the insight",
    //     },
    //     {
    //       "title": "The title of the insight will be here",
    //       "description": "Description of the insight",
    //     }
    //   ]
    // `;

    // const discoveryPrompt = `
    //   You are a senior B2B strategist and solutions consultant at a top global firm.

    //   Prospexs has already identified:
    //   - The company facing the challenge (${lead_company_name})
    //   - The strategic challenges they're dealing with (${parsedDetailsWithChallengesOutput.challenges})
    //   - The solution provider offering a relevant product or service (${company_name})
    //   - The potential solution and impact already mapped to each challenge

    //   Your task is to generate 5 sharp, strategic discovery questions for each challenge that the
    //   solution provider should ask the target company.

    //   For each question, include:
    //   - The exact question (clear and consultative in tone)
    //   - A short explanation (1-2 sentences) of why this question matters and what it will uncover

    //   These questions should:
    //   - Sound like they're coming from a seasoned enterprise AE, strategist, or product lead
    //   - Help uncover internal context, blockers, or workflows tied to the challenge
    //   - Prepare the provider to better scope, pitch, or implement their solution

    //   Avoid generic questions (like "What keeps you up at night?"). Make every question feel
    //   customized to the company's situation and the solution's capabilities.

    //   Important: Only use information that is explicitly available in the input data.
    //   Do not assume, invent, or guess details about the lead, their company, or their situation.
    //   If no relevant information is found, state that clearly.
    //   You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
    //   and always label them clearly as general context, not lead-specific insight.

    //   Example Discovery Questions for www.teamtailor.com

    //   Example Discovery Questions for X 1:

    //   Challenge 1: Standing Out in a Crowded ATS Market:
    //   Teamtailor is in a saturated market with competitors bundling AI, sourcing, and CRM features.
    //   Differentiation is getting harder - especially when price pressure and feature parity are
    //   increasing.

    //   Stripe's Discovery Questions (and Why They Matter):

    //   1. "What are the most common reasons your prospects choose a competitor over
    //   Teamtailor today?"
    //   Helps identify where Teamtailor may be perceived as lacking — price, features,
    //   enterprise depth, or brand.

    //   2. "Have you run any pricing experiments or packaging changes in the last 12
    //   months?"
    //   If they haven't, Stripe could offer flexible billing infrastructure to support rapid testing
    //   of pricing models (usage-based, modular, role-based).

    //   3. "How do you currently align pricing with perceived customer value across SMB
    //   vs. enterprise?"
    //   Reveals if Stripe's billing tools can help match value delivery with revenue capture
    //   (e.g. ARPA lift via tiering).

    //   4. "How often do you iterate on GTM messaging to reflect product evolution?"
    //   Could inform whether Stripe's insight tooling could help Teamtailor adjust
    //   product-market positioning faster.

    //   5. "Are you tracking expansion revenue or usage data to inform how you package or
    //   sell features?"
    //   If not, Stripe's tools can help track feature adoption and power smarter monetization
    //   decisions.

    //   Example Discovery Questions for X 2:

    //   Challenge 2: Scaling Into Enterprise Without Losing Simplicity
    //   Teamtailor wants to move upmarket, but enterprise deals bring long sales cycles, compliance
    //   demands, and billing complexity—while they still need to preserve a UX-friendly core product.

    //   Stripe's Discovery Questions:

    //   1. "What friction points have you encountered in procurement or compliance when
    //   selling to larger organizations?"
    //   Uncovers opportunity for Stripe to reduce procurement delays via localized invoicing,
    //   tax handling, or payment terms.

    //   2. "How are enterprise clients currently billed differently from your core SMB base?"
    //   Reveals if Stripe Billing or Invoicing can streamline complex enterprise payment
    //   plans or pricing agreements.

    //   3. "Do you currently offer contract flexibility (e.g. usage-based pricing or annual
    //   commits) for large clients?"
    //   Stripe can help Teamtailor support different contract models within a single billing
    //   stack.

    //   4. "Are you seeing demand for integrations with internal finance systems (e.g.
    //   Netsuite, SAP, Workday) during the sales cycle?"
    //   Indicates whether Stripe's enterprise APIs or financial reporting features can drive
    //   stickiness or accelerate implementation.

    //   5. "How do you maintain product simplicity while adapting to custom enterprise
    //   workflows?"
    //   Opens a conversation around Stripe's modular product architecture—only offer
    //   what's needed, when it's needed.

    //   Example Discovery Questions for X 3:

    //   Challenge 3: Falling Behind in AI-Driven Talent Tech Arms Race
    //   Competitors are embedding AI in matching, outreach, and screening. Teamtailor is strong in UX,
    //   but risks falling behind if it doesn't demonstrate innovation in hiring intelligence.

    //   Stripe's Discovery Questions:

    //   1. "What parts of the hiring journey are you actively exploring for AI-driven
    //   optimization?"
    //   Pinpoints where AI is being explored (e.g. candidate matching vs. interview scoring)
    //   and where Stripe data tools may support monetization.

    //   2. "Do you expect to charge for future AI-powered features, or bundle them into
    //   existing tiers?"
    //   Helps Stripe shape a billing model (add-on, usage-based, bundled) and prepare the
    //   infrastructure.

    //   3. "What metrics would define success for an AI feature in your platform—efficiency,
    //   accuracy, NPS?"
    //   Reveals Teamtailor's north star for innovation, and how Stripe's analytics tooling can
    //   help validate or monetize those outcomes.

    //   4. "How do you currently experiment with feature rollouts across different user
    //   segments?"
    //   Shows if Stripe's billing logic can support gated rollouts, feature flags, or user-level
    //   feature access.

    //   5. "Is there a monetization or revenue model attached to your AI roadmap today?"
    //   If not, Stripe can offer strategy + infrastructure to capture future AI value from day
    //   one.

    //   Example Discovery Questions for X 4:

    //   Challenge 4: Complexity in International Expansion
    //   Teamtailor is active in 90+ countries. That means multi-currency support, tax compliance,
    //   localization, and financial operations complexity—all of which Stripe is built to simplify.

    //   Stripe's Discovery Questions:

    //   1. "Which geographies are currently the most painful in terms of financial operations
    //   or compliance?"
    //   Lets Stripe recommend localized billing, currency support, and compliance services
    //   based on Teamtailor's priority markets.

    //   2. "Do you have internal resources managing tax and VAT handling across
    //   markets—or is it mostly manual?"
    //   Stripe Tax could immediately reduce overhead here if they're handling this with
    //   spreadsheets or external advisors.

    //   3. "Are you offering local payment methods in every region where you operate?"
    //   Stripe supports 50+ methods; this reveals if they can help increase conversion or
    //   reduce cart abandonment.

    //   4. "What's your approach to pricing localization—do you adapt plans by market?"
    //   Stripe's flexible pricing tools could let them dynamically adapt pricing based on
    //   region, without custom dev work.

    //   5. "How do you forecast or report on revenue by country or currency?"
    //   Stripe can help simplify multi-currency revenue recognition and offer richer financial
    //   dashboards, especially for CFO-level reporting.

    //   IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
    //   IMPORTANT: Return the answers in the following JSON format:
    //   [
    //     {
    //       "challenge": "The challenge that the solution provider should ask the target company about",
    //       "discovery_questions": [
    //         {
    //           "question": "The title of the discovery question will be here",
    //           "answer": "Description of the discovery question",
    //         },
    //         {
    //           "question": "The title of the discovery question will be here",
    //           "answer": "Description of the discovery question",
    //         }
    //       ]
    //     }
    //   ]
    // `;

    // const whyNotPrompt = `
    //   You are a senior GTM strategist and industry analyst at a top global consultancy.

    //   Prospexs has already identified:
    //   - The company facing strategic challenges (${lead_company_name})
    //   - The challenges they're dealing with:
    //   ${parsedDetailsWithChallengesOutput.challenges
    //     .map(
    //       (challenge) => `
    //       challenge title: ${challenge.title}
    //       challenge description: ${challenge.description}
    //     `
    //     )
    //     .join("\n")}
    //   - The solution provider (${company_name}) and what they offer:
    //   ${parsedSolutionsWithChallengesOutput
    //     .map(
    //       (challenge) => `
    //       solution title: ${challenge.solutions.map(
    //         (solution) => solution.solutionTitle
    //       )}
    //       solution description: ${challenge.solutions.map(
    //         (solution) => solution.solutionDescription
    //       )}
    //     `
    //     )
    //     .join("\n")}

    //   Your task is to generate a "Why Now?" analysis explaining why the solution provider should
    //   reach out and engage the company right now.

    //   For each challenge, explain:
    //   - Why this challenge is increasing in urgency right now (e.g. trends, competitor moves,
    //   regulatory shifts)
    //   - How the solution provider is uniquely positioned to address it

    //   - Include data points, industry insights, and analyst predictions (e.g. G2 trends, Gartner
    //   forecasts, growth benchmarks)

    //   Conclude with a short summary that ties together urgency, fit, and impact.

    //   Use a clear, confident tone — like you're writing a deal brief for a senior sales or partnerships
    //   leader.

    //   Important: Only use information that is explicitly available in the input data.
    //   Do not assume, invent, or guess details about the lead, their company, or their situation.
    //   If no relevant information is found, state that clearly.
    //   You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
    //   and always label them clearly as general context, not lead-specific insight.

    //   Example Why Now Insights for www.teamtailor.com

    //   Why Now Example 1: The ATS market is hitting feature parity—pricing innovation is becoming
    //   the new battleground.
    //   According to G2 and Productboard, over 60% of mid-market ATS buyers now consider “pricing
    //   model flexibility” a top decision factor, up from 34% in 2022. Platforms like Ashby and Lever are
    //   moving toward modular or usage-based pricing to reflect actual customer value. Teamtailor,
    //   which has historically leaned on flat-rate simplicity, risks commoditization unless it can
    //   differentiate on how it sells—not just what it sells. Stripe's flexible billing APIs and product-tiered
    //   infrastructure can enable Teamtailor to launch, A/B test, and localize monetization models
    //   without a backend overhaul.

    //   Why Now Example 2: Teamtailor's enterprise expansion will strain their current finance and
    //   billing stack.
    //   As more ATS vendors like Workable and SmartRecruiters shift toward enterprise accounts (with
    //   ARPA > $20K), buyer expectations around procurement infrastructure have hardened.
    //   Enterprise clients now demand things like ACH, SEPA, localized invoicing, VAT-compliant tax
    //   handling, and contract-based billing terms. If Teamtailor continues to grow in markets like
    //   Germany, the UK, and the Nordics, a modernized billing and finance ops layer is no longer
    //   optional. Stripe's enterprise-grade billing, invoicing, and tax stack can be deployed
    //   modularly—giving them global readiness without enterprise bloat.

    //   Why Now Example 3: The AI race in HR tech is accelerating—and monetization is lagging
    //   behind.
    //   Gartner predicts that by 2026, over 75% of hiring platforms will embed AI scoring, filtering, and
    //   auto-matching tools. But only 18% of them have a revenue model tied to these features.
    //   Teamtailor has already launched AI-driven workflows and evaluation tools—but it hasn't yet
    //   attached monetization logic. Stripe can help Teamtailor price these features as add-ons,
    //   usage-based modules, or higher-tier differentiators, turning AI investment into scalable revenue.

    //   Why Now Example 4: International expansion is increasing operational drag—and Stripe can
    //   remove it.
    //   Teamtailor now operates in 90+ countries. This means more currencies, localized payment
    //   methods, tax rules, and region-specific compliance headaches. Companies that don't solve for
    //   this early see slower rollout velocity and higher cost of finance ops. Stripe supports payments in
    //   135+ currencies, automates tax compliance across 40+ markets, and offers programmable
    //   payouts—letting Teamtailor expand faster without increasing headcount in back-office teams.

    //   Example Why Now Insights for www.remote.com

    //   Why Now Example 1: Navigating Global Compliance and Tax Complexity
    //   Remote is live in 180+ countries and growing fast—but this scale brings enormous financial
    //   compliance pressure. As regulators crack down on contractor misclassification and cross-border
    //   tax compliance, EOR and global payroll companies are under the microscope. In 2024, both
    //   Deel and Papaya Global faced intensified audits in high-risk markets. Remote must minimize
    //   exposure while maintaining speed. Stripe's tax and billing stack automates region-specific rules,
    //   cutting compliance overhead by up to 30% and enabling safe expansion into new markets
    //   without headcount bloat.

    //   Why Now Example 2: Slowing Onboarding and Conversion Velocity
    //   With competitors like Rippling and Deel investing heavily in onboarding UX and speed-to-hire,
    //   Remote risks falling behind. According to OpenView's 2024 SaaS benchmark, reducing
    //   onboarding friction increases activation rates by 25-40% in B2B platforms. Stripe's modular
    //   onboarding stack lets Remote securely verify users, accept payments globally, and automate
    //   account creation—all while staying compliant. The longer Remote delays UX-level
    //   optimizations, the more volume shifts to faster competitors.

    //   Why Now Example 3: Increasing Risk in Contractor Payouts and Regulatory Scrutiny
    //   The freelance and contractor economy is booming—but so is the risk. Inconsistent payout logic
    //   and KYC gaps can trigger financial and legal headaches, especially in markets like India, Brazil,
    //   and Nigeria. With platforms under pressure to pay faster and more transparently, Stripe's payout
    //   stack offers programmable wallets, automated AML/KYC, and real-time transfers. Remote can
    //   stay ahead of scrutiny and deliver a best-in-class contractor experience—before local fintech
    //   competitors fill that gap.

    //   Why Now Example 4: Managing Financial Complexity at Global Scale
    //   Remote is no longer just a startup—it's infrastructure for other companies' infrastructure. That
    //   means more expectations around stable, transparent financial systems. As they expand,
    //   operating costs grow linearly unless finance infrastructure improves. Stripe helps break that
    //   tradeoff—offering instant support for 135+ currencies, 50+ local payment methods, and clean
    //   financial data by region. If Remote waits, it risks ballooning ops costs and missing expansion
    //   targets in regions where payment preferences matter.

    //   IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
    //   IMPORTANT: Return the answers in the following JSON format:
    //   [
    //     {
    //       "challenge": "The challenge that the solution provider should ask the target company about",
    //       "why_now": "The why now analysis for the challenge",
    //     },
    //     {
    //       "challenge": "The challenge that the solution provider should ask the target company about",
    //       "why_now": "The why now analysis for the challenge",
    //     }
    //   ]
    // `;

    // const awardsPrompt = `
    //   You are a senior strategist specializing in analyzing LinkedIn profiles to uncover business
    //   context, signals, and intent.

    //   Your task is to review the following LinkedIn profile: ${lead_linkedin_url} data and extract a list of
    //   clear, concise, and notable achievements, such as:
    //   - Awards (e.g. “Leader of the Year 2022”)
    //   - Major milestones (e.g. “Promoted 3 times in 5 years”, “Worked at X for 10+ years”)
    //   - Public recognitions (e.g. “Featured in Forbes 30 Under 30”)
    //   - Career longevity highlights (e.g. “8 years at Google”, “Built first APAC office”)
    //   - Certifications only if they are prestigious or well-known (e.g. PMP, CFA, Google Developer
    //   Expert)

    //   This is the linkedin url: ${lead_linkedin_url}
    //   This is the linkedin data: {linkedin_data}

    //   Output should be a bullet point list, with 1-2 lines per item max.
    //   Do not include generic responsibilities or role descriptions. Only include standout achievements
    //   that differentiate this person from others.

    //   Use the tone of a high-end recruiter or executive search analyst summarizing why this person is
    //   notable.

    //   Important: Only use information that is explicitly available in the input data.
    //   Do not assume, invent, or guess details about the lead, their company, or their situation.
    //   If no relevant information is found, state that clearly.
    //   You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
    //   and always label them clearly as general context, not lead-specific insight.

    //   Example Award & Recognitions About X:
    //   Example Award & Recognition 1: Winner of 'Leader of the Year' at Telia Company in 2022.
    //   Example Award & Recognition 2: Promoted 3 times in 6 years at Klarna — from Analyst to
    //   Head of Growth.
    //   Example Award & Recognition 3: Named in Forbes 30 Under 30 - Technology, Europe list.
    //   Example Award & Recognition 4: Spent 10+ years at Ericsson.
    //   Example Award & Recognition 5: Built and scaled Spotify's first LATAM marketing team from
    //   0 to 40 people.
    //   Example Award & Recognition 6: Selected for McKinsey & Company's internal 'Top 1%
    //   Future Partner' program.
    //   Example Award & Recognition 7: Featured speaker at Web Summit 2024 on AI in
    //   e-commerce.
    //   Example Award & Recognition 8: Certified Google Developer Expert in Machine Learning
    //   since 2021.
    //   Example Award & Recognition 9: Led the product team behind the 'App of the Year' at the
    //   Swedish Tech Awards (2022).
    //   Example Award & Recognition 10: Received CEO's Performance Award at H&M Group.

    //   IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
    //   IMPORTANT: Return the answers in the following JSON format:
    //   [
    //     {
    //       "award": "The award or recognition",
    //       "description": "The description of the award or recognition",
    //     }
    //   ]
    // `;

    // const interestsPrompt = `
    //   You are a senior strategist specializing in analyzing LinkedIn profiles to uncover business
    //   context, signals, and intent.
    //   Analyze the following LinkedIn profile: ${lead_linkedin_url} data and extract a list of personal
    //   interests and hobbies.

    //   This is the linkedin url: ${lead_linkedin_url}
    //   This is the linkedin data: {linkedin_data}

    //   Focus on:
    //   - What they mention in their "About" section
    //   - Volunteering, extracurriculars, or activity feed
    //   - Any personal mentions in job descriptions (e.g. "Outside of work I...")
    //   Return the output as a bullet-point list of short, lowercase items, such as:
    //   - yoga
    //   - hiking
    //   - sci-fi
    //   - climate tech
    //   - volunteering
    //   Do not use full sentences. Do not add descriptions or context.
    //   Only include clear, humanizing interests that reflect the person's personality or lifestyle.
    //   Important: Only use information that is explicitly available in the input data.
    //   Do not assume, invent, or guess details about the lead, their company, or their situation.
    //   If no relevant information is found, state that clearly.
    //   You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
    //   and always label them clearly as general context, not lead-specific insight.

    //   Example Interests & Hobbies:
    //   - Trail running
    //   - Youth football coaching
    //   - Sci-fi books
    //   - Volunteering
    //   - Language learning
    //   - Startup mentoring
    //   - Yoga
    //   - Climate tech
    //   - Productivity apps
    //   - Hiking & camping

    //   If there are no interests or hobbies, return an empty array.

    //   IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
    //   IMPORTANT: Return the answers in the following JSON format:
    //   [
    //     "interest 1",
    //     "interest 2",
    //     "interest 3",
    //     "interest 4"
    //   ]
    // `;

    // const educationPrompt = `
    //   You are a senior strategist specializing in analyzing LinkedIn profiles to uncover business
    //   context, signals, and intent.

    //   Analyze the following LinkedIn profile: ${lead_linkedin_url} data and extract a list of the educational
    //   institutions this person has attended.

    //   This is the linkedin url: ${lead_linkedin_url}
    //   This is the linkedin data: {linkedin_data}

    //   Focus only on:
    //   - Universities
    //   - Business schools
    //   - Colleges
    //   - Recognized institutions of higher education

    //   Output format:
    //   - One bullet per school
    //   - Only include school names (e.g. "Lund University", "KTH Royal Institute of Technology")
    //   - No degrees, dates, or locations unless explicitly requested

    //   Important: Only use information that is explicitly available in the input data.
    //   Do not assume, invent, or guess details about the lead, their company, or their situation.
    //   If no relevant information is found, state that clearly.
    //   You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
    //   and always label them clearly as general context, not lead-specific insight.

    //   Example Interests & Hobbies:
    //   - Stockholm University
    //   - Lund University
    //   - Uppsala University
    //   - KTH Royal Institute of Technology
    //   - Chalmers University of Technology
    //   - London School of Economics
    //   - INSEAD
    //   - Harvard Business School
    //   - Copenhagen Business School
    //   - HEC Paris

    //   IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
    //   IMPORTANT: Return the answers in the following JSON format:
    //   [
    //     "school 1",
    //     "school 2"
    //   ]
    // `;

    // const relevantInsightsPrompt = `
    //   You are a senior strategist specializing in analyzing LinkedIn profiles to uncover business
    //   context, signals, and intent.

    //   Your job is to uncover relevant, human insights about a specific lead based on their LinkedIn
    //   profile and broader digital footprint (including posts, interviews, articles, public activity, and
    //   interactions).

    //   Your goal is to help a sales or partnership team quickly understand:
    //   - What this person cares about
    //   - What they're likely focused on right now
    //   - What topics, events, or trends they're publicly engaging with
    //   - Any subtle personal interests or behavioral cues that can make outreach or meetings
    //   more relevant

    //   Input sources may include:
    //   - LinkedIn bio, work history, posts, shares, comments, likes
    //   - Interviews, panels, podcasts
    //   - Company articles they're quoted in
    //   - Conferences or events they've attended
    //   - Anything else from their public presence

    //   This is the linkedin url: ${lead_linkedin_url}
    //   This is the linkedin data: {linkedin_data}

    //   Keep it tight, real, and usable in a cold email or intro call.

    //   Important: Only use information that is explicitly available in the input data.
    //   Do not assume, invent, or guess details about the lead, their company, or their situation.
    //   If no relevant information is found, state that clearly.
    //   You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
    //   and always label them clearly as general context, not lead-specific insight.

    //   Example Relevant Insights:
    //   - Title: Launch of AI features
    //   Recently posted about the launch of their AI-driven onboarding feature and shared a
    //   case study on reducing churn—likely focused on activation and retention right now.
    //   Attended Slush 2024 and shared photos from the 'Future of Work' stage—shows interest
    //   in workplace innovation. Also reposted multiple content pieces from Deel and Remote,
    //   suggesting they follow global employment trends closely.

    //   - Title: Team Culture
    //   Often comments on posts about team culture and internal communication. In a podcast
    //   last year, they mentioned scaling pains as a first-time VP—likely sensitive to tools that
    //   reduce internal friction. Also shared a personal post about running their first
    //   ultramarathon—possible tie-in to resilience, discipline, or health-focused narratives.

    //   - Title: Female Leadership & Diversity
    //   Liked a number of posts related to female leadership and diversity hiring in the past
    //   month. Was featured in a 'Meet the CMO' interview where she talked about the shift
    //   toward data-led decision-making in marketing. Attended INBOUND 2023 and tagged
    //   three product leaders from her team - possibly open to solutions that tighten
    //   marketing-product alignment.

    //   IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
    //   IMPORTANT: Return the answers in the following JSON format:
    //   [
    //     {
    //       "title": "The title of the insight",
    //       "description": "The description of the insight",
    //     },
    //     {
    //       "title": "The title of the insight",
    //       "description": "The description of the insight",
    //     },
    //   ]
    // `;

    const {
      step_5_result: { linkedin_url: user_linkedin_url, linkedin_profile },
    } = progressData;

    // const similaritiesPrompt = `
    //   You are a senior strategist specializing in analyzing LinkedIn profiles to uncover business
    //   context, signals, and intent.
    //   Your task is to identify genuine similarities between two people based on their LinkedIn
    //   profiles:
    //   - X = the user of Prospexs (Linkedin URL: ${user_linkedin_url})
    //   - Y = the lead (Linkedin URL: ${lead_linkedin_url})

    //   This is the linkedin data for "X" (the user of Prospexs): ${linkedin_profile}

    //   This is the linkedin data for "Y" (the lead): {linkedin_data}

    //   You will be given both LinkedIn profiles (including bios, work history, posts, education, interests,
    //   etc.).
    //   Your goal is to surface credible and natural connection points that the user could use to build
    //   rapport, open a conversation, or establish common ground.
    //   These may include:
    //   - Shared industries, roles, or company types
    //   - Similar career paths or titles
    //   - Common tools, technologies, or methodologies
    //   - Overlapping events, certifications, or regions
    //   - Shared causes, interests, or values (if publicly stated)

    //   Output Instructions:
    //   - List 4 high-quality similarities.
    //   - Use complete sentences.
    //   - Avoid generic or forced connections (e.g. “both work in tech” unless meaningful)
    //   - If no clear similarities are found, say so and do not guess.

    //   Important: Only use information that is explicitly available in the input data.
    //   Do not assume, invent, or guess details about the lead, their company, or their situation.
    //   If no relevant information is found, state that clearly. You may use industry benchmarks,
    //   role-specific patterns, or known trends only as a fallback — and always label them clearly as
    //   general context, not lead-specific insight. If no direct similarities are found, clearly state that —
    //   then provide 4 relevant role-based or industry-level commonalities based on their current titles,
    //   company types, or sectors.

    //   Clearly label these as professional context overlaps, not personal insights.

    //   Example Similarities Between X & Y:
    //   - Both X and Y have held commercial leadership roles at early-stage SaaS companies
    //   targeting mid-market clients. Their profiles reflect a strong bias toward product-led
    //   growth, with multiple posts referencing self-serve onboarding, usage-based pricing, or
    //   activation metrics.
    //   - While they've never worked at the same company, both transitioned from individual
    //   contributor roles into team lead positions during high-growth phases—likely sharing
    //   similar experiences around team-building under pressure.
    //   - Both X and Y are based in Europe but lead globally distributed teams. X is currently
    //   managing a remote RevOps team across 3 time zones, while Y recently posted about
    //   the operational challenges of async communication and building team culture across
    //   borders.
    //   - Their careers show a pattern of working in companies between 50-300
    //   employees—often the stage where processes break and operators are forced to build
    //   structure. It's likely they both value pragmatic, systems-driven solutions.
    //   - Y recently celebrated their 5-year company anniversary with a post about "resilience
    //   over hype," which aligns with X's earlier writing on long-term thinking vs. fundraising
    //   hype cycles. This shared founder mindset could lead to instant rapport.
    //   - Each has shown public interest in low-code tooling: Y recently liked several posts about
    //   Airtable and Notion automations, while X commented on how they've built internal
    //   systems to reduce reliance on engineering. This operational pragmatism is a shared
    //   trait.

    //   Replace X and Y with the actual names of the user of Prospexs and the lead.
    //   X name: ${linkedin_profile.full_name}
    //   Y name: ${lead.full_name}

    //   IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
    //   IMPORTANT: Return the answers in the following JSON format:
    //   [
    //     "similarity 1",
    //     "similarity 2"
    //   ]
    // `;

    // const onlineMentionsPrompt = `
    //   You are a strategic research analyst within a B2B prospecting engine.
    //   Your task is to find relevant mentions or signals connected to a specific lead, based on the
    //   following input:
    //   - Name: ${lead.full_name}
    //   - Job Title: ${lead.job_title}
    //   - Company: ${lead.lead_company_name}

    //   TIER 1 - Mentions of the Lead (First Priority)
    //   Search for:
    //   - Recent quotes, interviews, or media appearances by the lead
    //   - Mentions of the lead in company press releases, blogs, or events
    //   - LinkedIn posts where the lead is tagged or publicly commented

    //   If any mentions are found, summarize:
    //   - The nature of the mention (e.g. quote, panelist, author)
    //   - The topic covered
    //   - Why it may be relevant for outreach or context

    //   TIER 2 - Mentions of Their Company (Fallback)

    //   If no lead-specific mentions are available, look for:
    //   - Company press releases, major announcements, or funding news
    //   - Mentions in case studies, customer stories, or third-party blogs
    //   - Comments or reactions to the company's product, hiring, or performance

    //   Summarize the mention and what it signals about the company's current focus or perception.

    //   TIER 3 - Mentions of Industry or Competitors (Last Resort)
    //   If no mentions of the lead or their company are found, provide:
    //   - A short summary of recent trends, challenges, or opportunities relevant to their industry
    //   or segment
    //   - Mentions of 1-2 close competitors or peers (if available)
    //   - Why these trends or competitor actions might be top-of-mind for the lead
    //   No relevant mentions were found for the lead or their company.
    //   Only use information that is explicitly available in the input data. Do not fabricate mentions or
    //   speculate. Clearly indicate which tier was used: Lead, Company, or Industry. If nothing relevant
    //   is found at any tier, say so.

    //   Example Online Mentions:
    //   - Mention Type: Podcast Interview
    //   Summary: In a recent podcast episode of SaaS GTM Deep Dives, Sarah Lindqvist (VP
    //   of Sales at Flowly) discussed how her team shifted from SDR-led to marketing-led
    //   pipeline generation in Q1 2024. She emphasized attribution challenges, cross-team
    //   alignment, and her team's focus on increasing average deal size.
    //   Link: https://example.com/sarah-lindqvist-podcast

    //   - Mention Type: TechCrunch Article
    //   Summary: Flowly was featured in a TechCrunch piece announcing its $12M Series A,
    //   led by Index Ventures. The article quotes the CEO discussing expansion into France and
    //   doubling the GTM team by the end of the year. No direct quote from Sarah, but as VP
    //   Sales, she will likely be involved in hiring and sales team growth.
    //   Link: https://example.com/flowly-seriesa

    //   - Mention Type: Industry Report
    //   Summary: A recent Forrester report titled “2024 SaaS Buying Trends in Europe”
    //   highlights that 64% of mid-market buyers now prefer product-led onboarding with
    //   minimal sales rep involvement. This trend could directly impact how companies like
    //   Flowly position their sales motion, especially given their expansion plans.
    //   Link: https://example.com/2024-saas-buying-trends

    //   - Mention Type: Panel Discussion
    //   Summary: Nabil El-Fahkri, Head of Product at Mindbeam, appeared as a speaker on a
    //   panel titled “AI Ethics in Enterprise Software” during Nordic Tech Week 2024. He spoke
    //   about balancing speed of deployment with regulatory alignment, especially in B2B SaaS.
    //   His comments suggest a strong interest in AI governance and responsible innovation.
    //   Link: https://example.com/nabil-panel-ai-ethics

    //   - Mention Type: Customer Case Study (Company Blog)
    //   Summary: Mindbeam recently published a case study highlighting how pharmaceutical
    //   company Axxira improved workflow compliance by 48% after switching to Mindbeam's
    //   platform. Although Nabil is not quoted directly, the project falls under his product team,
    //   suggesting relevance to his current priorities.
    //   Link: https://example.com/nabil-mindbeam-casestudy

    //   IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
    //   IMPORTANT: Return the answers in the following JSON format:
    //   [
    //     {
    //       "mention_type": "The type of mention",
    //       "summary": "The summary of the mention",
    //       "link": "The link to the mention",
    //     },
    //     {
    //       "mention_type": "The type of mention",
    //       "summary": "The summary of the mention",
    //       "link": "The link to the mention",
    //     },
    //   ]
    // `;

    // const relevantActivitiesPrompt = `
    //   You are a senior outbound strategist inside a B2B prospecting platform.
    //   Your task is to analyze a specific lead's recent LinkedIn activity to surface signals that could be
    //   useful for sales outreach or meeting prep.

    //   This is the linkedin url: ${lead_linkedin_url}
    //   This is the linkedin data: {linkedin_data}

    //   Focus on surfacing:
    //   - Posts authored by the lead
    //   - Comments they've made on relevant topics
    //   - Content they've liked or reshared
    //   - Mentions or tags by other people
    //   - Changes in profile headline or role
    //   - Event RSVPs, certifications, or feature badges

    //   The activity should reflect:
    //   - What the lead is currently thinking about, engaging with, or promoting
    //   - Topics that align with their strategic focus or personal interests
    //   - Cues that suggest timing or mindset (e.g., hiring, launching, exploring tools)

    //   Output Format:
    //   For each insight you find, include:
    //   - A summary of the activity (2-3 sentences)
    //   - The type of interaction (e.g., post, comment, like, reshare, profile update)
    //   - A link to the post or profile section (if available)
    //   - The date or time frame (e.g., “2 weeks ago”)
    //   - Optional: Why this may be relevant to outreach

    //   Example Relevant LinkedIn Activity:
    //   - Summary: Posted a job opening for two Enterprise Account Executives in the DACH
    //   region, emphasizing experience in AI/ML products.
    //   Type: Authored post
    //   Link: https://linkedin.com/posts/anne-hartmann_eae-hiring-ai
    //   When: 6 days ago
    //   Relevance: Indicates current hiring focus and possible pipeline expansion in Germany
    //   — good timing for outreach around GTM enablement or recruiting efficiency.

    //   - Summary: Liked a post from a competitor (DocuMate) announcing their new e-signature
    //   integration with Microsoft Teams.
    //   Type: Like
    //   Link: https://linkedin.com/feed/update/documate-teams
    //   When: 1 week ago
    //   Relevance: Suggests interest in adjacent products or keeping tabs on market trends —
    //   could signal a focus on integrations or product roadmap updates.

    //   - Summary: Commented “This is the biggest pain point in onboarding right now” on a post
    //   discussing slow customer implementation cycles in B2B SaaS.
    //   Type: Comment
    //   Link: https://linkedin.com/feed/update/slow-onboarding-thread
    //   When: 2 weeks ago
    //   Relevance: Signals frustration with onboarding speed — could open the door for
    //   workflow automation, CS tooling, or faster deployment solutions.

    //   - Summary: Shared an article from Harvard Business Review titled "Why CFOs Are
    //   Becoming Product Influencers” with the caption “Seeing this trend firsthand.”
    //   Type: Reshare
    //   Link: https://linkedin.com/share/cfo-trend-hbr
    //   When: 5 days ago
    //   Relevance: Suggests the lead may be a financially-minded decision-maker with
    //   influence beyond pure finance — good for positioning ROI-driven tools.

    //   - Summary: Updated their LinkedIn title from “Growth Advisor” to “VP, Strategic
    //   Partnerships” at Klara Health.
    //   Type: Profile Update
    //   Link: https://linkedin.com/in/sofia-karlsen
    //   When: 3 weeks ago
    //   Relevance: Signals a new role and likely open priorities — perfect window to introduce
    //   new tools or explore co-marketing, integrations, or partnerships.

    //   IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
    //   IMPORTANT: Return the answers in the following JSON format:
    //   [
    //     {
    //       "summary": "The summary of the activity",
    //       "type": "The type of interaction",
    //       "link": "The link to the post or profile section",
    //       "when": "The date or time frame",
    //       "relevance": "The relevance of the activity"
    //     }
    //   ]
    // `;

    // const personConversationalStarterPrompt = `
    //   You are a senior outbound strategist inside a B2B prospecting engine.
    //   Your task is to generate relevant, natural, and timely conversation starters for ${lead.full_name}
    //   based on all available data.

    //   This is the linkedin url: ${lead_linkedin_url}
    //   This is the linkedin data: {linkedin_data}

    //   Input Context May Include:
    //   - The lead's LinkedIn activity (posts, likes, profile updates, comments)
    //   - Any recent mentions of the lead in media, panels, podcasts, or interviews
    //   - Their company's latest news, funding, hiring, or product launches
    //   - Industry shifts or competitor activity that might be top-of-mind for someone in their
    //   role
    //   - Known challenges, solutions, and impact statements previously identified by
    //   Prospexs

    //   Your job is to:
    //   - Combine 1-2 relevant signals into each friendly, human-level prompt
    //   - Avoid generic or templated phrasing (“Saw your role, thought I'd reach out”)
    //   - Focus on curiosity, relevance, and shared interest to spark a reply or discussion
    //   - Use a tone that is personable, warm, and professionally casual
    //   Output Format:
    //   - Generate 3-4 short conversation starters, each 2-3 sentences max.
    //   - Important: Only use signals that are explicitly present in the input data. Do not assume or
    //   fabricate insights. If few signals are available, you may fall back on role-specific or industry-level
    //   cues — but clearly anchor them to the lead's function, not imagined details.

    //   Example Relevant LinkedIn Activity:
    //   - Title: Fixing Onboarding Friction
    //   I saw your post about navigating long onboarding cycles and the impact on revenue
    //   recognition — feels like something a lot of GTM teams are quietly battling. Curious if
    //   you've tried anything new to streamline that process, especially now that you're leading
    //   both sales and CS under one roof.

    //   - Title: Scaling After Funding
    //   Congrats on the Series B — with that kind of growth, I imagine aligning product, sales,
    //   and ops just got a whole lot more interesting. I'd love to hear how you're thinking about
    //   scaling the GTM motion without letting complexity creep in.

    //   - Title: AI for Reps: Real or Hype?
    //   Noticed you commented on a post about AI not replacing reps, but making them sharper
    //   — couldn't agree more. In your role, are you seeing any tools actually live up to that
    //   promise, or is it still mostly buzz?

    //   - Title: Product vs. Sales Mindset
    //   You and I both seem to follow folks like Kyle Coleman and Lenny Rachitsky — always
    //   find their takes useful for keeping GTM grounded. Given your background in both
    //   product and sales, I'm curious how you're balancing top-down strategy with bottom-up
    //   activation these days.

    //   - Title: Competitor PLG Moves
    //   I saw that one of your close competitors just launched in the DACH region with a very
    //   PLG-heavy push. Wondering if that's affecting how your team's thinking about customer
    //   acquisition strategy or if you're doubling down on something totally different.

    //   IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
    //   IMPORTANT: Return the answers in the following JSON format:
    //   [
    //     {
    //       "title": "The title of the conversation starter",
    //       "content": "The content of the conversation starter",
    //     },
    //     {
    //       "title": "The title of the conversation starter",
    //       "content": "The content of the conversation starter",
    //     },
    //   ]
    // `;

    // const additionalPrompts = [
    //   {
    //     prompt: conversationStarterPrompt,
    //     fieldName: "conversationStarters",
    //     category: "businessInsights",
    //   },
    //   {
    //     prompt: commonalitiesPrompt,
    //     fieldName: "commonalities",
    //     category: "businessInsights",
    //   },
    //   {
    //     prompt: insightsPrompt,
    //     fieldName: "insights",
    //     category: "businessInsights",
    //   },
    //   {
    //     prompt: discoveryPrompt,
    //     fieldName: "discovery",
    //     category: "businessInsights",
    //   },
    //   {
    //     prompt: whyNotPrompt,
    //     fieldName: "whyNow",
    //     category: "businessInsights",
    //   },
    //   {
    //     prompt: awardsPrompt,
    //     fieldName: "awards",
    //     category: "personInsights",
    //     getLinkedinData: true,
    //   },
    //   {
    //     prompt: interestsPrompt,
    //     fieldName: "interests",
    //     category: "personInsights",
    //     getLinkedinData: true,
    //   },
    //   {
    //     prompt: educationPrompt,
    //     fieldName: "education",
    //     category: "personInsights",
    //     getLinkedinData: true,
    //   },
    //   {
    //     prompt: relevantInsightsPrompt,
    //     fieldName: "relevantInsights",
    //     category: "personInsights",
    //     getLinkedinData: true,
    //   },
    //   {
    //     prompt: similaritiesPrompt,
    //     fieldName: "similarities",
    //     category: "personInsights",
    //     getLinkedinData: true,
    //   },
    //   {
    //     prompt: onlineMentionsPrompt,
    //     fieldName: "onlineMentions",
    //     category: "personInsights",
    //     getLinkedinData: true,
    //   },
    //   {
    //     prompt: relevantActivitiesPrompt,
    //     fieldName: "relevantActivities",
    //     category: "personInsights",
    //     getLinkedinData: true,
    //   },
    //   {
    //     prompt: personConversationalStarterPrompt,
    //     fieldName: "personConversationalStarters",
    //     category: "personInsights",
    //     getLinkedinData: true,
    //   },
    // ];

    // const promises = additionalPrompts.map(
    //   async ({ prompt, fieldName, category, getLinkedinData }, index) => {
    //     try {
    //       console.log(`===== Step ${index + 5}: Getting ${fieldName} =====`);

    //       if (getLinkedinData) {
    //         const proxycurlApiKey = Deno.env.get("Proxycurl_API");
    //         const url = new URL("https://enrichlayer.com/api/v2/profile");

    //         url.searchParams.set("url", lead_linkedin_url);
    //         url.searchParams.set("use_cache", "if-present");

    //         console.log("Making request to:", url.toString());

    //         const response = await fetch(url.toString(), {
    //           method: "GET",
    //           headers: {
    //             Authorization: `Bearer ${proxycurlApiKey}`,
    //           },
    //         });

    //         const linkedinData = await response.json();
    //         prompt = prompt.replace(
    //           "{linkedin_data}",
    //           JSON.stringify(linkedinData)
    //         );
    //       }

    //       const response = await openai.responses.create({
    //         model: "gpt-4.1",
    //         tools: [{ type: "web_search_preview" }],
    //         input: prompt,
    //       });

    //       console.log(
    //         `Response for ${fieldName}:`,
    //         response.output_text.trim()
    //       );

    //       let cleanResponse = response.output_text.trim();

    //       const jsonMatch = cleanResponse.match(/```json\s*([\s\S]*?)\s*```/);
    //       if (jsonMatch) {
    //         cleanResponse = jsonMatch[1].trim();
    //       } else if (cleanResponse.startsWith("```json")) {
    //         cleanResponse = cleanResponse
    //           .replace(/^```json\s*/, "")
    //           .replace(/\s*```$/, "");
    //       } else if (cleanResponse.startsWith("```")) {
    //         cleanResponse = cleanResponse
    //           .replace(/^```\s*/, "")
    //           .replace(/\s*```$/, "");
    //       }

    //       let parsedResponse;
    //       try {
    //         parsedResponse = JSON.parse(cleanResponse);
    //       } catch (error) {
    //         console.error(`Failed to parse ${fieldName} output:`, error);
    //         throw new Error(`Failed to parse AI response for ${fieldName}`);
    //       }

    //       result[category][fieldName] = parsedResponse;

    //       return parsedResponse;
    //     } catch (error) {
    //       result[category][fieldName] = [];
    //       console.error(`---- Error getting ${fieldName}:`, error);
    //     }
    //   }
    // );

    // await Promise.all(promises);

    if (!leadExists) {
      step_10_result.push({ ...lead, insights: result });
    }

    const { error: updateError } = await supabase
      .from("campaign_progress")
      .update({
        latest_step: 10,
        step_10_result: step_10_result,
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
