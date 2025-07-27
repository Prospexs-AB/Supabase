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

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    const { lead_company_name } = lead;
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
      - Use business-relevant language (e.g. “reduce compliance risk,” “increase lead conversion,”
      “cut onboarding time”)
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
    for (const challenge of parsedSolutionsWithChallengesOutput) {
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

    // STEP 4: Get objection handling
    console.log("===== Step 4: Getting objection handling =====");

    // Handle each challenge
    // for (const challenge of impactsOfSolutions) {
    //   const objectionHandlingPerChallenge = [];

    //   // Handle each solution for the challenge
    //   // for (const solution of challenge.solutions) {
    //   //   const objectionHandlingPrompt = `
    //   //     You are a senior B2B strategist at a top consultancy, preparing a sales or success team for
    //   //     high-stakes outreach.

    //   //     Prospexs has already identified:
    //   //     - The lead company's current business challenges: ${challenge.description}.
    //   //     - The user's proposed solution: ${solution.solutionDescription}.
    //   //     - The projected impact of implementing that solution: ${solution.impactDescription}.

    //   //     Now, your task is to anticipate 4 realistic objections the lead company might raise - even when
    //   //     the impact is strong.

    //   //     For each objection, follow this format:
    //   //     1. Objection: Write it exactly as a stakeholder might say it
    //   //     2. Why it's valid: Briefly explain the business logic or concern behind it (timing, budget,
    //   //     legacy systems, priorities, etc.)
    //   //     3. How to work around it: Offer a clear, strategic workaround (e.g. phased rollout, pilot
    //   //     approach, reframing ROI, using existing internal champions, or connecting to an ongoing
    //   //     initiative)

    //   //     Use a tone that is sharp, strategic, and empathetic. You're not just selling—you're helping the
    //   //     buyer get unstuck and move forward confidently.
    //   //     Important: Only use information that is explicitly available in the input data.
    //   //     Do not assume, invent, or guess details about the lead, their company, or their situation.
    //   //     If no relevant information is found, state that clearly.
    //   //     You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
    //   //     and always label them clearly as general context, not lead-specific insight.

    //   //     Example Detected Objection Handling for www.teamtailor.com:

    //   //     Example Objection 1:
    //   //     "We're not ready to overhaul our billing and pricing infrastructure—our current system works
    //   //     well enough."
    //   //     Why it's valid:
    //   //     Teamtailor likely runs a lean ops team focused on product and GTM. Introducing a new billing
    //   //     system—especially one tied to pricing models—can feel risky and time-consuming, especially
    //   //     when core revenue is stable.
    //   //     Workaround:
    //   //     Position Stripe as a tool to layer in monetization experiments, not replace the core system.
    //   //     Suggest piloting usage-based pricing for one product line, region, or customer
    //   //     segment—without disrupting the rest. This frames Stripe as a way to unlock revenue innovation
    //   //     rather than a system overhaul.

    //   //     Example Objection 2:
    //   //     "We sell to SMBs—enterprise-level billing capabilities and compliance tools feel excessive for
    //   //     our current customer base."
    //   //     Why it's valid:
    //   //     Most of Teamtailor's historic growth has been SMB-driven, where simple billing and flat pricing
    //   //     are usually enough. Enterprise features may seem like overkill or too forward-looking.
    //   //     Workaround:
    //   //     Tie Stripe's enterprise-grade features to Teamtailor's strategic move upmarket. Emphasize
    //   //     that larger deals often stall due to procurement issues (e.g. payment methods, invoicing
    //   //     standards, tax handling)—all of which Stripe can solve without headcount. Show how Stripe
    //   //     helps them remove friction before it becomes a revenue blocker.

    //   //     Example Objection 3:
    //   //     "Adding AI-based pricing or feature gating sounds interesting—but we're still figuring out our AI
    //   //     roadmap."
    //   //     Why it's valid:
    //   //     Teamtailor is likely early in productizing AI, and monetization is probably not yet prioritized. They
    //   //     might worry that billing logic will outpace feature readiness.
    //   //     Workaround:
    //   //     Position Stripe's usage-based billing as a future-proofing move—built to support AI features
    //   //     when they launch. Offer to co-develop pricing models (e.g. pay-per-insight, pay-per-screened
    //   //     candidate) so the GTM strategy is ready when product is—shortening time-to-monetization.

    //   //     Example Objection 4:
    //   //     "Global payments and tax tools sound great, but we already have local finance workflows set up
    //   //     for most regions."
    //   //     Why it's valid:
    //   //     They've already made the investment—local teams, accountants, and manual workarounds are
    //   //     in place. Replacing them might feel like sunk cost waste or unnecessary disruption.
    //   //     Workaround:
    //   //     Position Stripe as a scaling tool, not a replacement. Highlight that as they expand to new
    //   //     regions, Stripe lets them avoid building more localized finance ops. Stripe becomes the
    //   //     default engine for net-new countries, giving them optionality and reducing marginal cost of
    //   //     expansion.

    //   //     Example Detected Objection Handling for www.remote.com:

    //   //     Example Objection 1:
    //   //     "We've already built our own global payments and invoicing flows—it's deeply embedded in our
    //   //     ops."
    //   //     Why it's valid:
    //   //     Remote likely spent significant engineering and compliance resources to build custom
    //   //     infrastructure for invoicing, multi-currency payments, and tax handling. Replacing or
    //   //     supplementing it feels like technical debt or wasted investment.
    //   //     Workaround:
    //   //     Frame Stripe as a selective abstraction layer—not a replacement. Suggest starting with Stripe
    //   //     in new markets or new customer segments (e.g. SMB self-serve or fast-growing emerging
    //   //     markets). This allows Remote to avoid repeating internal buildouts while keeping control over
    //   //     core systems.

    //   //     Example Objection 2:
    //   //     "Honestly, our biggest internal bottleneck right now isn't billing — it's legal and compliance. We're
    //   //     expanding into more countries and dealing with increasingly complex regulatory environments.
    //   //     Most of our internal resources, budget, and leadership attention are focused on scaling those
    //   //     teams and keeping us audit-ready. Billing improvements sound useful, but they're not what's
    //   //     keeping us up at night.

    //   //     Why it's valid:
    //   //     Remote operates across dozens of jurisdictions, each with its own employment laws, tax
    //   //     regulations, and compliance obligations. As they grow, especially in emerging or complex
    //   //     markets, ensuring compliance isn't just a cost issue—it's a risk mitigation priority. Legal and
    //   //     compliance hires are often the gatekeepers for launching in new countries, onboarding clients,
    //   //     or staying audit-ready. Compared to that, billing may seem secondary or at least less urgent.

    //   //     Workaround:
    //   //     Acknowledge that priority—but reposition billing as an enabler of scale, not a distraction.
    //   //     Manual or rigid billing processes create friction for legal/compliance too: delays in localized
    //   //     contracts, invoice errors across tax zones, or disputes from misaligned billing terms often land
    //   //     on legal's desk. Streamlining billing reduces internal escalations, contract exceptions, and
    //   //     compliance firefighting.
    //   //     Suggest a pilot in one region with the most billing/legal crossover pain. Or link to existing
    //   //     compliance initiatives: "Let's make billing a zero-escalation zone while legal scales up."
    //   //     Also, if Remote is currently focused on hiring, positioning the billing upgrade as a way to delay
    //   //     headcount pressure (fewer finance hires needed) can align with their broader goals.

    //   //     Example Objection 3:
    //   //     "We've had real challenges using Stripe in several of the markets where we operate. It's not just
    //   //     about collecting payments—Stripe doesn't fully support some of the countries or local rails we
    //   //     rely on, especially in regions like Africa or Southeast Asia. For us, that creates friction with
    //   //     compliance, FX, and even payroll in certain cases. We can't afford to patch things together or
    //   //     risk legal exposure just because the billing system can't handle a country's local infrastructure.
    //   //     Until Stripe expands coverage, it's hard to make it core to our stack in these regions."

    //   //     Why it's valid:
    //   //     Remote's value prop hinges on enabling compliant employment in 180+ countries. That means
    //   //     every part of their infrastructure—HR, payroll, invoicing, and tax—must function smoothly across
    //   //     borders. If Stripe lacks coverage in key regions (e.g., no local rails, unsupported currencies,
    //   //     delayed payouts), it forces Remote to implement workaround systems that increase compliance
    //   //     risk and operational complexity. At their scale, this isn't just an inconvenience—it's a direct
    //   //     threat to trust, delivery, and customer experience in high-growth markets

    //   //     Workaround:
    //   //     Position Stripe not as a replacement, but as a complement to their existing stack—starting in
    //   //     high-volume or low-risk regions where Stripe does offer full support. Emphasize that Stripe can
    //   //     help standardize and streamline billing in ~80% of their covered markets, freeing up internal
    //   //     resources to focus on the legal edge cases. Also highlight existing Stripe partners and
    //   //     integrators (e.g. Paystack for Africa, or local PSP bridges) to extend regional coverage
    //   //     without building custom infrastructure. If relevant, propose a sandbox or pilot rollout tied
    //   //     to one region or product line where billing complexity is stalling growth—but compliance
    //   //     concerns are minimal.
    //   //     The goal isn't to replace everything—just to remove friction where possible, so legal and
    //   //     finance teams can focus where they're truly needed.

    //   //     Example Objection 4:
    //   //     "Our finance and ops teams are already stretched. We're onboarding new markets, adapting to
    //   //     local tax and employment laws, and supporting rapid headcount growth. Adding another
    //   //     integration project—especially one that touches billing, invoicing, and reporting—just isn't
    //   //     something we can absorb right now. Even if the long-term value is clear, we simply don't have
    //   //     the bandwidth in this quarter."

    //   //     Why it's valid:
    //   //     In hypergrowth companies like Remote, finance and operations teams are often the last to
    //   //     scale, even as complexity explodes. Every integration means competing for limited dev cycles,
    //   //     reconciling multiple systems, and retraining teams already operating at capacity. Even small
    //   //     billing changes can cascade into legal, reporting, payroll, and customer support—so the
    //   //     hesitation isn't resistance to improvement, it's a real capacity constraint and risk-aversion in
    //   //     critical internal workflows.

    //   //     Workaround:
    //   //     Reframe the Stripe integration as low-lift and high-leverage, not another burden. Offer a
    //   //     phased rollout that starts with a single market, client segment, or product line—minimizing
    //   //     operational disruption while proving value. Emphasize how automating billing can actually
    //   //     reduce the load on ops by eliminating manual reconciliations, late payments, and internal
    //   //     support escalations.
    //   //     If available, highlight plug-and-play integrations, pre-built Stripe connectors, or support from
    //   //     Stripe's Solutions Engineers who can shoulder the technical heavy lifting. You can also point to
    //   //     comparable companies that shipped a similar setup in under X weeks with minimal ops
    //   //     involvement.
    //   //     The key is shifting the perception from "one more project" to "one fewer headache."

    //   //     IMPORTANT: You must return ONLY valid JSON in the exact format specified below. Do not include any explanatory text, markdown formatting, or additional content outside the JSON structure.
    //   //     Return the answers in the following JSON format:
    //   //     {
    //   //       "solutionTitle": "Solution for challenge",
    //   //       "solutionDescription": "Description of solution for challenge",
    //   //       "impactTitle": "Impact for challenge",
    //   //       "impactDescription": "Description of impact of solution for challenge",
    //   //       "objectionHandling": [
    //   //         {
    //   //           "objection": "Objection 1 for challenge",
    //   //           "whyItsValid": "Description of objection 1 for challenge",
    //   //           "howToWorkAroundIt": "Description of how to work around objection 1 for challenge"
    //   //         }
    //   //       ]
    //   //     }
    //   //   `;

    //   //   const objectionHandlingOutput = await openai.responses.create({
    //   //     model: "gpt-4.1",
    //   //     tools: [{ type: "web_search_preview" }],
    //   //     input: objectionHandlingPrompt,
    //   //   });

    //   //   let cleanObjectionHandlingOutput =
    //   //     objectionHandlingOutput.output_text.trim();
    //   //   if (cleanObjectionHandlingOutput.startsWith("```json")) {
    //   //     cleanObjectionHandlingOutput = cleanObjectionHandlingOutput
    //   //       .replace(/^```json\s*/, "")
    //   //       .replace(/\s*```$/, "");
    //   //   } else if (cleanObjectionHandlingOutput.startsWith("```")) {
    //   //     cleanObjectionHandlingOutput = cleanObjectionHandlingOutput
    //   //       .replace(/^```\s*/, "")
    //   //       .replace(/\s*```$/, "");
    //   //   }

    //   //   const parsedObjectionHandlingOutput = JSON.parse(
    //   //     cleanObjectionHandlingOutput
    //   //   );

    //   //   objectionHandlingPerChallenge.push(parsedObjectionHandlingOutput);
    //   // }

    //   const promises = challenge.solutions.map(async (solution) => {
    //     const objectionHandlingPrompt = `
    //       You are a senior B2B strategist at a top consultancy, preparing a sales or success team for
    //       high-stakes outreach.

    //       Prospexs has already identified:
    //       - The lead company's current business challenges: ${challenge.description}.
    //       - The user's proposed solution: ${solution.solutionDescription}.
    //       - The projected impact of implementing that solution: ${solution.impactDescription}.

    //       Now, your task is to anticipate 4 realistic objections the lead company might raise - even when
    //       the impact is strong.

    //       For each objection, follow this format:
    //       1. Objection: Write it exactly as a stakeholder might say it
    //       2. Why it's valid: Briefly explain the business logic or concern behind it (timing, budget,
    //       legacy systems, priorities, etc.)
    //       3. How to work around it: Offer a clear, strategic workaround (e.g. phased rollout, pilot
    //       approach, reframing ROI, using existing internal champions, or connecting to an ongoing
    //       initiative)

    //       Use a tone that is sharp, strategic, and empathetic. You're not just selling—you're helping the
    //       buyer get unstuck and move forward confidently.
    //       Important: Only use information that is explicitly available in the input data.
    //       Do not assume, invent, or guess details about the lead, their company, or their situation.
    //       If no relevant information is found, state that clearly.
    //       You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
    //       and always label them clearly as general context, not lead-specific insight.

    //       Example Detected Objection Handling for www.teamtailor.com:

    //       Example Objection 1:
    //       "We're not ready to overhaul our billing and pricing infrastructure—our current system works
    //       well enough."
    //       Why it's valid:
    //       Teamtailor likely runs a lean ops team focused on product and GTM. Introducing a new billing
    //       system—especially one tied to pricing models—can feel risky and time-consuming, especially
    //       when core revenue is stable.
    //       Workaround:
    //       Position Stripe as a tool to layer in monetization experiments, not replace the core system.
    //       Suggest piloting usage-based pricing for one product line, region, or customer
    //       segment—without disrupting the rest. This frames Stripe as a way to unlock revenue innovation
    //       rather than a system overhaul.

    //       Example Objection 2:
    //       "We sell to SMBs—enterprise-level billing capabilities and compliance tools feel excessive for
    //       our current customer base."
    //       Why it's valid:
    //       Most of Teamtailor's historic growth has been SMB-driven, where simple billing and flat pricing
    //       are usually enough. Enterprise features may seem like overkill or too forward-looking.
    //       Workaround:
    //       Tie Stripe's enterprise-grade features to Teamtailor's strategic move upmarket. Emphasize
    //       that larger deals often stall due to procurement issues (e.g. payment methods, invoicing
    //       standards, tax handling)—all of which Stripe can solve without headcount. Show how Stripe
    //       helps them remove friction before it becomes a revenue blocker.

    //       Example Objection 3:
    //       "Adding AI-based pricing or feature gating sounds interesting—but we're still figuring out our AI
    //       roadmap."
    //       Why it's valid:
    //       Teamtailor is likely early in productizing AI, and monetization is probably not yet prioritized. They
    //       might worry that billing logic will outpace feature readiness.
    //       Workaround:
    //       Position Stripe's usage-based billing as a future-proofing move—built to support AI features
    //       when they launch. Offer to co-develop pricing models (e.g. pay-per-insight, pay-per-screened
    //       candidate) so the GTM strategy is ready when product is—shortening time-to-monetization.

    //       Example Objection 4:
    //       "Global payments and tax tools sound great, but we already have local finance workflows set up
    //       for most regions."
    //       Why it's valid:
    //       They've already made the investment—local teams, accountants, and manual workarounds are
    //       in place. Replacing them might feel like sunk cost waste or unnecessary disruption.
    //       Workaround:
    //       Position Stripe as a scaling tool, not a replacement. Highlight that as they expand to new
    //       regions, Stripe lets them avoid building more localized finance ops. Stripe becomes the
    //       default engine for net-new countries, giving them optionality and reducing marginal cost of
    //       expansion.

    //       Example Detected Objection Handling for www.remote.com:

    //       Example Objection 1:
    //       "We've already built our own global payments and invoicing flows—it's deeply embedded in our
    //       ops."
    //       Why it's valid:
    //       Remote likely spent significant engineering and compliance resources to build custom
    //       infrastructure for invoicing, multi-currency payments, and tax handling. Replacing or
    //       supplementing it feels like technical debt or wasted investment.
    //       Workaround:
    //       Frame Stripe as a selective abstraction layer—not a replacement. Suggest starting with Stripe
    //       in new markets or new customer segments (e.g. SMB self-serve or fast-growing emerging
    //       markets). This allows Remote to avoid repeating internal buildouts while keeping control over
    //       core systems.

    //       Example Objection 2:
    //       "Honestly, our biggest internal bottleneck right now isn't billing — it's legal and compliance. We're
    //       expanding into more countries and dealing with increasingly complex regulatory environments.
    //       Most of our internal resources, budget, and leadership attention are focused on scaling those
    //       teams and keeping us audit-ready. Billing improvements sound useful, but they're not what's
    //       keeping us up at night.

    //       Why it's valid:
    //       Remote operates across dozens of jurisdictions, each with its own employment laws, tax
    //       regulations, and compliance obligations. As they grow, especially in emerging or complex
    //       markets, ensuring compliance isn't just a cost issue—it's a risk mitigation priority. Legal and
    //       compliance hires are often the gatekeepers for launching in new countries, onboarding clients,
    //       or staying audit-ready. Compared to that, billing may seem secondary or at least less urgent.

    //       Workaround:
    //       Acknowledge that priority—but reposition billing as an enabler of scale, not a distraction.
    //       Manual or rigid billing processes create friction for legal/compliance too: delays in localized
    //       contracts, invoice errors across tax zones, or disputes from misaligned billing terms often land
    //       on legal's desk. Streamlining billing reduces internal escalations, contract exceptions, and
    //       compliance firefighting.
    //       Suggest a pilot in one region with the most billing/legal crossover pain. Or link to existing
    //       compliance initiatives: "Let's make billing a zero-escalation zone while legal scales up."
    //       Also, if Remote is currently focused on hiring, positioning the billing upgrade as a way to delay
    //       headcount pressure (fewer finance hires needed) can align with their broader goals.

    //       Example Objection 3:
    //       "We've had real challenges using Stripe in several of the markets where we operate. It's not just
    //       about collecting payments—Stripe doesn't fully support some of the countries or local rails we
    //       rely on, especially in regions like Africa or Southeast Asia. For us, that creates friction with
    //       compliance, FX, and even payroll in certain cases. We can't afford to patch things together or
    //       risk legal exposure just because the billing system can't handle a country's local infrastructure.
    //       Until Stripe expands coverage, it's hard to make it core to our stack in these regions."

    //       Why it's valid:
    //       Remote's value prop hinges on enabling compliant employment in 180+ countries. That means
    //       every part of their infrastructure—HR, payroll, invoicing, and tax—must function smoothly across
    //       borders. If Stripe lacks coverage in key regions (e.g., no local rails, unsupported currencies,
    //       delayed payouts), it forces Remote to implement workaround systems that increase compliance
    //       risk and operational complexity. At their scale, this isn't just an inconvenience—it's a direct
    //       threat to trust, delivery, and customer experience in high-growth markets

    //       Workaround:
    //       Position Stripe not as a replacement, but as a complement to their existing stack—starting in
    //       high-volume or low-risk regions where Stripe does offer full support. Emphasize that Stripe can
    //       help standardize and streamline billing in ~80% of their covered markets, freeing up internal
    //       resources to focus on the legal edge cases. Also highlight existing Stripe partners and
    //       integrators (e.g. Paystack for Africa, or local PSP bridges) to extend regional coverage
    //       without building custom infrastructure. If relevant, propose a sandbox or pilot rollout tied
    //       to one region or product line where billing complexity is stalling growth—but compliance
    //       concerns are minimal.
    //       The goal isn't to replace everything—just to remove friction where possible, so legal and
    //       finance teams can focus where they're truly needed.

    //       Example Objection 4:
    //       "Our finance and ops teams are already stretched. We're onboarding new markets, adapting to
    //       local tax and employment laws, and supporting rapid headcount growth. Adding another
    //       integration project—especially one that touches billing, invoicing, and reporting—just isn't
    //       something we can absorb right now. Even if the long-term value is clear, we simply don't have
    //       the bandwidth in this quarter."

    //       Why it's valid:
    //       In hypergrowth companies like Remote, finance and operations teams are often the last to
    //       scale, even as complexity explodes. Every integration means competing for limited dev cycles,
    //       reconciling multiple systems, and retraining teams already operating at capacity. Even small
    //       billing changes can cascade into legal, reporting, payroll, and customer support—so the
    //       hesitation isn't resistance to improvement, it's a real capacity constraint and risk-aversion in
    //       critical internal workflows.

    //       Workaround:
    //       Reframe the Stripe integration as low-lift and high-leverage, not another burden. Offer a
    //       phased rollout that starts with a single market, client segment, or product line—minimizing
    //       operational disruption while proving value. Emphasize how automating billing can actually
    //       reduce the load on ops by eliminating manual reconciliations, late payments, and internal
    //       support escalations.
    //       If available, highlight plug-and-play integrations, pre-built Stripe connectors, or support from
    //       Stripe's Solutions Engineers who can shoulder the technical heavy lifting. You can also point to
    //       comparable companies that shipped a similar setup in under X weeks with minimal ops
    //       involvement.
    //       The key is shifting the perception from "one more project" to "one fewer headache."

    //       IMPORTANT: You must return ONLY valid JSON in the exact format specified below. Do not include any explanatory text, markdown formatting, or additional content outside the JSON structure.
    //       Return the answers in the following JSON format:
    //       {
    //         "solutionTitle": "Solution for challenge",
    //         "solutionDescription": "Description of solution for challenge",
    //         "impactTitle": "Impact for challenge",
    //         "impactDescription": "Description of impact of solution for challenge",
    //         "objectionHandling": [
    //           {
    //             "objection": "Objection 1 for challenge",
    //             "whyItsValid": "Description of objection 1 for challenge",
    //             "howToWorkAroundIt": "Description of how to work around objection 1 for challenge"
    //           }
    //         ]
    //       }
    //     `;

    //     const objectionHandlingOutput = await openai.responses.create({
    //       model: "gpt-4.1",
    //       tools: [{ type: "web_search_preview" }],
    //       input: objectionHandlingPrompt,
    //     });

    //     let cleanObjectionHandlingOutput =
    //       objectionHandlingOutput.output_text.trim();
    //     if (cleanObjectionHandlingOutput.startsWith("```json")) {
    //       cleanObjectionHandlingOutput = cleanObjectionHandlingOutput
    //         .replace(/^```json\s*/, "")
    //         .replace(/\s*```$/, "");
    //     } else if (cleanObjectionHandlingOutput.startsWith("```")) {
    //       cleanObjectionHandlingOutput = cleanObjectionHandlingOutput
    //         .replace(/^```\s*/, "")
    //         .replace(/\s*```$/, "");
    //     }

    //     const parsedObjectionHandlingOutput = JSON.parse(
    //       cleanObjectionHandlingOutput
    //     );

    //     objectionHandlingPerChallenge.push(parsedObjectionHandlingOutput);
    //   );
    //   const results = await Promise.all(promises);

    //   challenge.solutions = results;
    // }

    for (const challenge of impactsOfSolutions) {
      const promises = challenge.solutions.map(async (solution) => {
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

      const results = await Promise.all(promises);
      challenge.solutions = results;
    }

    result.businessInsights.challengesWithSolutions = impactsOfSolutions;

    // STEP 5: Get Conversation Starter
    console.log("===== Step 5: Getting conversation starter =====");
    const conversationStarterPrompt = `
      You are a senior B2B strategist at a top-tier consultancy preparing for high-level outreach or
      networking with a senior stakeholder (VP, C-level, or strategic buyer).
      Prospexs has already analyzed the target company's:
      - Product or service
      - Position in the market
      - Business model and GTM strategy
      - Challenges, growth areas, and recent developments

      These are the challenges that Prospexs has identified from the target company in JSON format:
      ${JSON.stringify(
        result.businessInsights.challengesWithSolutions,
        null,
        2
      )}

      Your task is to generate 3-4 insight-driven conversation starters, each rooted in recent
      company news, product announcements, market moves, or strategic updates.
      For each one:
      - Start with a short title (4-6 words max)
      - Then write a 2-3 sentence conversation starter
      Each question should:
      - Reference a specific public update, launch, or trend relevant to the company
      - Tie that update to a broader strategic question or point of curiosity
      - Be framed in a smart, consultative, and respectful tone
      - Invite thoughtful conversation—not yes/no answers or surface-level reactions
      Avoid generic or cliché questions. Prioritize context, timeliness, and relevance.
      Important: Only use information that is explicitly available in the input data.
      Do not assume, invent, or guess details about the lead, their company, or their situation.
      If no relevant information is found, state that clearly.
      You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
      and always label them clearly as general context, not lead-specific insight.

      Example Conversation Starters for www.teamtailor.com

      Example Conversation Starters 1: Doubling Down on Skills-Based Hiring - Teamtailor recently
      introduced skill-based filtering, giving recruiters more control in shortlisting candidates based on
      specific competencies rather than just resumes. As more companies shift toward
      competency-first hiring to tackle role misalignment and reduce bias, how are you positioning this
      feature to serve both tech-savvy scaleups and more traditional hiring teams who may still rely on
      gut feel or CVs?

      Example Conversation Starters 2: Cleaning Up Candidate Data at Scale - The new
      LinkedIn-based duplicate detection feature is a smart move for teams juggling high volumes of
      applications across multiple roles. In what ways are you planning to use this to improve data
      quality and reduce recruiter time spent on administrative filtering—especially as your mid-market
      and enterprise clients demand faster time-to-hire with cleaner pipelines?

      Example Conversation Starters 3: Hiring Workflows Are Getting Smarter—But Are Hiring
      Managers Ready? - Teamtailor's recent updates hint at more powerful, automated
      workflows—including more advanced filters, evaluations, and automated actions. Are you
      seeing friction from hiring managers who may find the increasing complexity overwhelming?
      And how are you thinking about education or UI design to keep adoption high as the product
      becomes more intelligent?

      Example Conversation Starters 4: AI vs. Human-Centric Hiring - There's been a lot of hype
      around AI-driven hiring, but Teamtailor has always stood out for human-centered UX and strong
      employer brand tools. As more competitors lean into 'AI-first' messaging, how do you see that
      narrative fitting into Teamtailor's growth story - especially in markets that still value
      personalization and candidate experience?

      Example Conversation Starters for www.stripe.com

      Example Conversation Starters 1: AI Foundation Model for Payment Intelligence - Stripe
      recently unveiled its own AI foundation model, trained on over 100 billion data points from global
      payment flows. It's already being deployed to improve fraud detection, risk modeling, and
      checkout personalization. For a platform with Stripe's scale, this represents a shift from reactive
      tooling to proactive, intelligent infrastructure. How is Stripe thinking about expanding the impact
      of this model—not just in fraud prevention, but also in things like conversion optimization,
      dynamic pricing, or dispute resolution?

      Example Conversation Starters 2: Stablecoin Financial Accounts and Treasury
      Transformation - With its new stablecoin financial accounts, Stripe now lets businesses hold
      balances in digital dollars (USDC), use them to pay vendors, and eventually integrate them into
      their own financial stack. The service is live in 101 countries—positioning Stripe not just as a
      payments provider but as a programmable treasury layer for modern internet businesses. What
      kind of feedback is Stripe seeing from SaaS or marketplace platforms that are trying to reduce
      FX fees, shorten settlement times, or simplify cross-border reconciliation using this feature?

      Example Conversation Starters 3: Payment Orchestration as a Strategic Wedge - Stripe's
      new Orchestration feature allows merchants to route payments through multiple providers within
      the Stripe environment—without rebuilding internal logic. This is a big move in a market where
      enterprises increasingly want multi-PSP setups for reliability, optimization, and global flexibility.
      Is Stripe seeing this as a way to deepen enterprise lock-in, or more as an open architecture
      move to win over companies that historically avoided single-provider risk?

      Example Conversation Starters 4: Checkout Optimization Through Real-Time AI
      Personalization - Stripe has upgraded its Optimized Checkout Suite with AI-driven logic that
      dynamically personalizes the checkout flow per user, based on thousands of micro-signals (e.g.
      geography, device, past behavior). Early testing has shown conversion lifts of over 2%-a big
      delta at enterprise scale. As Stripe continues to lean into data-led infrastructure, what are the
      downstream implications for merchants who might want to own this layer themselves? Is there a
      play here for Stripe to become the de facto optimization layer, not just the processor?

      IMPORTANT: Directly respond in the JSON format provided below. Do not include any explanatory text, markdown formatting, or additional content outside the JSON structure.
      IMPORTANT: Return the answers in the following JSON format:
      [
        {
          "title": "The title of the conversation starter will be here",
          "description": "Description of the conversation starter",
        },
        {
          "title": "The title of the conversation starter will be here",
          "description": "Description of the conversation starter",
        }
      ]
    `;

    const conversationStarterOutput = await openai.responses.create({
      model: "gpt-4.1",
      tools: [{ type: "web_search_preview" }],
      input: conversationStarterPrompt,
    });

    let cleanConversationStarterOutput =
      conversationStarterOutput.output_text.trim();
    if (cleanConversationStarterOutput.startsWith("```json")) {
      cleanConversationStarterOutput = cleanConversationStarterOutput
        .replace(/^```json\s*/, "")
        .replace(/\s*```$/, "");
    } else if (cleanConversationStarterOutput.startsWith("```")) {
      cleanConversationStarterOutput = cleanConversationStarterOutput
        .replace(/^```\s*/, "")
        .replace(/\s*```$/, "");
    }

    const parsedConversationStarterOutput = JSON.parse(
      cleanConversationStarterOutput
    );

    result.businessInsights.conversationStarters =
      parsedConversationStarterOutput;

    // STEP 6: Get commonalities
    console.log("===== Step 6: Getting commonalities =====");

    const {
      step_2_result: { company_name },
    } = progressData;

    const commonalitiesPrompt = `
      You are a senior B2B strategist at a top global consultancy.

      Prospexs has already analyzed the business models, value propositions, and go-to-market
      strategies of both companies listed below.

      Your task is to identify 4 deep, strategic similarities between the two companies. These
      similarities should help the user ${company_name} build trust, relevance, or credibility when reaching
      out to ${lead_company_name}.

      Focus on real, non-obvious business commonalities, such as:
      - Monetization model (e.g. usage-based, seat-based)
      - Customer acquisition strategy (e.g. PLG, direct sales, ecosystem-led)
      - Target buyer persona (e.g. devs, recruiters, CFOs)
      - Technical architecture (API-first, ecosystem integrations, modularity)
      - Internationalization strategy
      - Unit economics (e.g. high NRR, expansion revenue, LTV/CAC logic)

      Use data or market logic where possible (e.g. based on company size, funding stage, product
      motion, reported NRR benchmarks, etc.).

      Format each similarity as a short, insight-rich paragraph. Write with the tone of a strategist or
      investor—not a marketer.
      Do not include generic similarities like "both are SaaS companies." Focus on what's strategically
      interesting or commercially relevant.

      Important: Only use information that is explicitly available in the input data.
      Do not assume, invent, or guess details about the lead, their company, or their situation.
      If no relevant information is found, state that clearly.
      You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
      and always label them clearly as general context, not lead-specific insight.

      Example Detected Similarities Between www.teamtailor.com and www.stripe.com:

      Example Similarities 1: ExamUsage-Based, Scalable SaaS Models Designed for High LTV
      Stripe and Teamtailor both monetize through usage-aligned pricing models—Stripe via
      transaction volume and modular APIs, Teamtailor via seats, brand modules, and usage tiers.
      This results in high NRR (net revenue retention)—a critical SaaS metric. Stripe's NRR has been
      estimated north of 125%, while Teamtailor's customer retention and upsell motion (across
      10,000+ companies) reflects similar unit economics: land small, expand over time. Both are
      structured to grow with their customers' success.

      Example Similarities 2: Dominant in PLG-Friendly Buyer Personas
      Stripe sells to developers and product teams. Teamtailor sells to in-house recruiters and
      employer branding leads. These are bottom-up buyers, historically underserved by legacy
      systems like Oracle or SAP. According to OpenView's PLG benchmark report, 61% of
      top-performing SaaS companies use a PLG strategy to land SMB and mid-market accounts
      before moving into enterprise—a playbook both Stripe and Teamtailor have mastered.

      Example Similarities 3: International Growth With Localized Infrastructure
      Stripe supports payments in 135+ currencies across 45+ countries with localized compliance,
      tax, and payout logic. Teamtailor operates in 90+ countries, offering localized career pages,
      language support, and hiring workflows. Both face the same challenge: enabling regional depth
      at global scale. Their international expansions rely not on HQ-based assumptions but on
      platform customization at the local level—a rare operational capability in SaaS.

      Example Similarities 4: API-Centric, Extensible Platforms Built for Ecosystem Scale
      Stripe's API-first approach led to 3rd-party adoption across 100K+ startups and platforms (e.g.
      Shopify, Amazon, GitHub). Teamtailor, while not an API company, has built one of the most
      integrated ATS platforms, with over 100 plug-and-play integrations including Slack, Zapier,
      LinkedIn, and scheduling tools. Both companies treat extensibility as a strategic moat—reducing
      churn by embedding deeper into the workflows of their users and ecosystems.

      Example Detected Similarities Between www.remote.com and www.stripe.com:

      Example Similarities 1: Global Compliance Infrastructure at Scale
      Stripe and Remote.com both operate as regulatory infrastructure companies in their respective
      verticals. Stripe manages complex global financial compliance across 135+ currencies and 45+
      countries, including KYC, AML, tax automation, and payment licensing. Remote operates legal
      entities in 180+ countries, handling employment law, payroll tax compliance, and contractor
      classification. Both companies reduce regulatory overhead and legal exposure for fast-scaling
      businesses, allowing them to enter new markets in days instead of months. This shared
      positioning as a "compliance shield" makes them part of the modern international expansion
      stack.

      Example Similarities 2: API-Centric Growth Engines Driving Embedded Revenue
      Stripe generates a significant portion of its revenue via API-led integrations with platforms like
      Shopify, Amazon, and Notion—powering embedded finance flows. Similarly, Remote is building
      embedded HR infrastructure, with public partnerships and integrations (e.g. Greenhouse,
      BambooHR) and a growing API product to let platforms offer payroll and compliance as a
      service. Both companies are transitioning from SaaS to "platform revenue" models, where third
      parties generate and own the customer relationship, while Stripe/Remote operate quietly
      underneath. This shift supports exponential distribution and monetization without linear sales
      headcount growth.

      Example Similarities 3: Usage-Based Monetization With Exceptional Net Revenue
      Retention
      Stripe's NRR has been reported to exceed 125-130%, largely due to transactional pricing.
      Remote uses a similar model, charging per employee or contractor managed, with expansion
      into value-added services like benefits, stock options, and local compliance advisory. In markets
      with high CAC and long sales cycles, usage-based expansion is a moat—it boosts LTV,
      minimizes churn, and aligns growth with customer success. Stripe and Remote are both
      designed to win land-and-expand motions in tech-forward B2B segments.

      Example Similarities 4: Dominating in Decentralized, Post-COVID Workflows
      Post-2020, the rise of remote work and international commerce made Stripe and Remote
      indispensable. Stripe's adoption skyrocketed as businesses went digital—facilitating payments
      for Shopify, Amazon, Notion, and 100k+ others. Remote grew by over 10x between 2020 and
      2022, driven by the need to hire talent globally without establishing foreign subsidiaries. Both
      companies are winning in the decentralized operations economy—where business is global
      from day one, and infrastructure needs to be borderless, automated, and compliant.

      IMPORTANT: Directly respond in the JSON format provided below. Do not include any explanatory text, markdown formatting, or additional content outside the JSON structure.
      IMPORTANT: Return the answers in the following JSON format:
      [
        {
          "title": "The title of the similarity will be here",
          "description": "Description of the similarity",
        },
        {
          "title": "The title of the similarity will be here",
          "description": "Description of the similarity",
        }
      ]
    `;

    const commonalitiesOutput = await openai.responses.create({
      model: "gpt-4.1",
      tools: [{ type: "web_search_preview" }],
      input: commonalitiesPrompt,
    });

    let cleanCommonalitiesOutput = commonalitiesOutput.output_text.trim();
    if (cleanCommonalitiesOutput.startsWith("```json")) {
      cleanCommonalitiesOutput = cleanCommonalitiesOutput
        .replace(/^```json\s*/, "")
        .replace(/\s*```$/, "");
    } else if (cleanCommonalitiesOutput.startsWith("```")) {
      cleanCommonalitiesOutput = cleanCommonalitiesOutput
        .replace(/^```\s*/, "")
        .replace(/\s*```$/, "");
    }

    const parsedCommonalitiesOutput = JSON.parse(cleanCommonalitiesOutput);

    result.businessInsights.commonalities = parsedCommonalitiesOutput;

    // TODO: Handle save for multiple leads
    const { error: updateError } = await supabase
      .from("campaign_progress")
      .update({
        latest_step: 9,
        step_9_result: result,
      })
      .eq("id", campaignData.progress_id);

    if (updateError) {
      console.error("Error updating campaign progress:", updateError);
      return new Response(JSON.stringify({ error: updateError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(JSON.stringify({ lead, insights: result }), {
      headers: { "Content-Type": "application/json" },
    });
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
