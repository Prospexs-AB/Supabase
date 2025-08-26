// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "npm:openai";
import { z } from "npm:zod@3.25.76";
import { zodTextFormat } from "npm:openai/helpers/zod";
import Anthropic from "npm:@anthropic-ai/sdk";

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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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
      apikey: Deno.env.get("ZENROWS_API_KEY"),
    });

    console.log("Scraping URL:", company_website);

    const response = await fetch(
      `https://api.zenrows.com/v1/?${params.toString()}`
    );

    console.log("ZenRows response status:", response.status);
    const html = await response.text();
    console.log("Raw HTML length:", html.length);
    console.log("Raw HTML preview:", html.substring(0, 500));

    const zenrowsContent = cleanHtmlContent(html);

    const uspPrompt = `
      You are a senior industry analyst at a top global consultancy.

      Your task: Identify 5 Unique Selling Propositions (USPs) for the company ${company_website}.

      MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language_code}.
      FOR EXAMPLE IF THE LANGUAGE CODE IS "sv" THEN THE TEXT SHOULD BE RETURNED IN SWEDISH AND IF THE LANGUAGE CODE IS "en" THEN THE TEXT SHOULD BE RETURNED IN ENGLISH AND SO ON.

      This is the summary of the company thats been generated:
      ${content}

      This it the raw content from the website:
      ${zenrowsContent}

      Primary sources:
      - Verifiable, publicly available information: press releases, funding announcements,
      adoption metrics, credible news websites, customer case studies, product descriptions,
      testimonials, and investor reports.

      Secondary source:
      - The company's official website (for product descriptions and positioning only).
      Sources: Use multiple independent sources for each USP. Every figure or named claim must
      be attributed with source name + URL (e.g., press release, case study, investor report, or
      credible news coverage).

      For each USP:
      - Length: ~250 words. Treat each as a mini-analysis suitable for a consulting deck.
      - Structure: Use a clear title followed by 3 short paragraphs for scanability.
      - Mandatory data points: Include at least 2-3 quantified figures (e.g., funding amounts,
      revenue/adoption growth, customer counts, satisfaction scores, productivity metrics, market
      share, geographical coverage) and name at least one major customer or partner, with dates
      (year/quarter) where relevant.
      - Why it matters: Explain the business problem solved and how this USP differentiates
      ${company_name} from competitors.
      - Broader implications: Briefly analyze what this USP means for the company's customers or
      the market.
      - Comparative framing: Where possible, compare to industry averages or competitors to
      make the USP stand out.

      Citations: Provide the source URL for every figure or named claim.
      No generic claims: Avoid unverified statements or vague marketing copy. Every assertion must
      be backed by evidence.
      
      Output format:
      USP 1: [Title]
      - [Paragraph 1: Context + core USP + metrics]
      - [Paragraph 2: Supporting data + customer example + differentiation]
      - [Paragraph 3: Market implications + strategic insight]
      Sources: [URL]
      (Repeat for all 5 USPs)

      Examples of Benefits for www.legora.com:

      1. Material Time and Cost Reductions Across Core Legal Processes
      ● Legora delivers up to 90% time savings in contract review workflows such as due
      diligence, commercial lease analysis, and regulatory audits (Legora Product Overview).
      This translates to projects that once consumed 200-300 associate hours now being
      completed in less than 30, freeing teams to focus on high-value strategic work. This
      efficiency is critical in a legal services market where fixed-fee engagements now
      account for ~30% of corporate legal work (Law.com Fixed-Fee Trends Report 2024),
      forcing firms to deliver more with leaner resourcing.
      ● For law firms, these gains enable 15-20% margin improvements on fixed-fee matters
      while avoiding proportional headcount increases. In-house legal teams benefit from
      accelerated contract turnaround times—in some cases improving decision-making
      speed by 40%—and reduced reliance on expensive outside counsel for routine reviews.
      Legora's competitive edge over legacy contract-management tools lies in its AI
      workflows pre-trained on legal-specific contract types and industry-specific
      clauses, reducing setup time and error rates versus generic NLP platforms.
      ● This positions Legora as particularly compelling for regulated sectors like financial
      services and real estate, where large-scale lease and compliance reviews can become
      cost-prohibitive without automation. By delivering measurable efficiency
      improvements, Legora creates a clear ROI narrative for both law firms under pricing
      pressure and corporate legal teams aiming to streamline operations.

      2. Structured Legal Data Enables Strategic, Not Just Operational, Value
      ● Legora transforms static contract repositories into structured, queryable datasets,
      enabling law firms and in-house teams to surface systemic exposure across
      hundreds or thousands of documents (Legora Product Overview). For example,
      identifying termination-risk clauses across 500+ leases can now be done in
      hours—not weeks—reducing review timelines by up to 80%. This capability supports
      M&A readiness, supply-chain risk assessments, and compliance planning, turning
      legal data into a decision-support asset rather than an archival function. In-house
      departments at multinationals across financial services and manufacturing report
      that Legora reduced cross-jurisdictional review cycles by 30-40% compared to manual
      or semi-automated approaches.
      ● Unlike legacy CLM systems that focus narrowly on storage and access, Legora delivers
      out-of-the-box analytics and benchmarking, requiring no extensive post-processing or
      in-house data science teams. This mirrors enterprise trends in finance and procurement,
      where real-time, structured insights have become a baseline for C-suite
      decision-making (Gartner Legal Ops Survey 2024).
      ● By elevating legal from reactive risk mitigation to proactive strategic planning, Legora
      creates a competitive edge for organizations with complex global operations. Its
      ability to integrate insights into enterprise-wide risk dashboards not only increases tool
      adoption but also strengthens legal's role in corporate governance—turning the function
      into a true partner in business strategy.

      3. High Client Involvement in Product Development Drives Relevance
      ● Unlike traditional legal-tech vendors that ship broad, generic tools, Legora operates a
      co-development model with key customers—such as Goodwin, a global Am Law 50
      firm—to design features aligned with real-world legal workflows (Legora Press Release).
      This close collaboration has led to a 40% faster time-to-adoption for new features and
      has helped Legora achieve above-industry average customer retention rates in its
      enterprise segment. By field-testing beta capabilities with select clients, the company
      accelerates product-market fit and ensures solutions are robust before general release.
      ● In an industry where only 34% of legal teams are digitally mature (Gartner Legal Ops
      Report 2024), this collaborative innovation loop ensures Legora's roadmap remains
      grounded in customer priorities—spanning AI-powered clause libraries,
      regulatory-specific templates, and cross-jurisdiction review workflows. This
      approach reduces training and change-management burdens for clients, resulting in up
      to 25% lower implementation times versus traditional contract-management systems.
      ● Strategically, this "co-creation loop" creates high switching costs and extends
      customer lifetime value, giving Legora a defensible moat against competitors who
      struggle to replicate this level of client-integrated development. By positioning itself as a
      partner, not just a vendor, Legora becomes a critical enabler for large-scale
      enterprise deals, solidifying its relevance in a market historically resistant to legal-tech
      adoption.

      4. Enterprise-Grade Scalability for Global Legal Operations
      ● Legora's platform is architected for global deployment, supporting multilingual
      document review in 20+ languages and seamless operations across dozens of legal
      jurisdictions (Legora Product Architecture Whitepaper). This makes it particularly
      attractive for Am Law 100 firms and multinational in-house teams, which often manage
      contract portfolios spanning 30+ countries. Customers report that consolidating onto
      Legora has reduced their vendor stack by up to 40%, cutting licensing and
      maintenance costs across their legal tech ecosystem.
      ● Unlike point solutions that serve single-jurisdiction needs, Legora delivers API-driven
      integrations with leading CRM, document-management (DMS), and e-billing
      systems, transforming it into a system of record within the broader enterprise tech
      stack. This eliminates vendor fragmentation—a persistent pain point for global legal
      departments juggling multiple tools—and improves data flow across legal,
      procurement, compliance, and finance functions.
      ● In a market where cross-border legal spend is projected to grow 6-8% annually to
      $466B by 2027 (PwC Legal Trends 2025), Legora's ability to scale while maintaining
      audit-ready oversight across regions with diverse data-privacy regimes delivers both
      cost and governance advantages. By positioning itself as the backbone of global
      legal operations, Legora differentiates itself from niche AI review tools, which lack
      enterprise-grade extensibility and integration depth.

      5. Audit-Ready Outputs Support Governance and Compliance at Scale
      ● Legora delivers audit-ready exports that extract and structure contract data—down to
      party names, payment triggers, and obligations—in regulator-compliant formats
      (Legora Compliance Documentation). This functionality is particularly valuable for highly
      regulated industries like finance, energy, and healthcare, where compliance lapses can
      result in fines exceeding $5M per incident (Thomson Reuters Regulatory Trends
      2024). In practice, corporate legal teams report that Legora reduces response times to
      regulator inquiries by up to 60%, enabling faster completion of audits and litigation
      discovery requests.
      ● By eliminating the error-prone, manual copy-paste approach common in Excel or Word,
      Legora mitigates downstream liability and provides structured outputs that can
      integrate directly into enterprise compliance dashboards and risk-management
      platforms. This allows legal teams to function as proactive partners in enterprise-wide
      governance initiatives rather than reactive bottlenecks. Customers in the energy sector
      have reported a 25-30% reduction in audit preparation costs after adopting Legora.
      ● In a landscape where regulatory enforcement actions increased 12% YoY in 2024
      (Thomson Reuters), Legora positions itself as an essential component of corporate
      compliance infrastructure. By embedding governance functionality directly into its
      platform, Legora not only improves operational efficiency but also enhances the
      strategic role of legal teams in risk oversight—strengthening their visibility and value
      within the C-suite.

      Ensure source has name. For example, if the source url is "www.bbcnews.com/news/some-article-name"
      then the name of the source should be "BBC News" and not "BBC News - Some Article Name".
      Please analyze the content and create a company analysis following this structure and dont forget the source for each point AND USE THE LANGUAGNE FROM THE LANGUAGE CODE: ${language_code}.
      IMPORTANT: Make sure that the link for sources are not shown in the actual analysis value but put in the source array, do not include citations in the analysis value.
      Return ONLY a valid JSON object in this exact format (no markdown formatting, no backticks, no extra words outside the json object):
      [
        {
          "title": "your title here",
          "value": "your analysis here (no links here!!)",
          "source": [ { "name": "name of source", "url": "your source url here" } ]
        }
      ]
    `;

    const problemSolvedPrompt = `
      You are a senior industry analyst at a top global consultancy.
      
      Your task: Identify 5 major problems that ${company_website} solves for its customers.

      MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language_code}.
      FOR EXAMPLE IF THE LANGUAGE CODE IS "sv" THEN THE TEXT SHOULD BE RETURNED IN SWEDISH AND IF THE LANGUAGE CODE IS "en" THEN THE TEXT SHOULD BE RETURNED IN ENGLISH AND SO ON.

      This is the summary of the company thats been generated:
      ${content}

      This it the raw content from the website:
      ${zenrowsContent}

      Primary sources:
      - Verifiable, publicly available information: press releases, case studies, customer
      testimonials, adoption metrics, credible news coverage, and investor reports.

      Secondary source:
      - The company's official website.
      
      Sources: Use multiple independent sources for each problem solved. Every figure or named
      claim must be attributed with source name + URL (e.g., press release, case study, investor
      report, or credible news coverage).

      For each problem solved:
      - Length: ~250 words. Treat each as a mini-analysis suitable for a consulting deck.
      - Structure: Use a short, precise title, followed by 3 short paragraphs.
      - Mandatory data points: Include at least 3 quantified figures (e.g., turnover rates,
      absenteeism %, cost impacts, growth rates, customer counts, operational benchmarks) and
      name at least one customer or partner. Where possible, compare to industry averages or
      competitor approaches.
      - Context: Clearly describe the problem and why it matters (market or operational impact).
      - Solution: Explain how ${company_website} solves it (specific features, programs, or
      approaches) and why this approach is different from traditional solutions.
      - Strategic implication: Briefly analyze the broader business impact for the customer (e.g.,
      cost savings, compliance risk reduction, competitive advantage).
      
      Citations: Provide the source name + URL for every figure or named claim.
      No generic claims: Avoid vague statements or unverified marketing copy. Every assertion must
      be backed by evidence.

      Output format:
      Problem Solved 1: [Title]
      - [Paragraph 1: Problem + market context + metrics]
      - [Paragraph 2: Impact + supporting data + customer example]
      - [Paragraph 3: How ${company_website} solves it + why it's different]
      Sources: [URL]

      Examples of Problems Solved for www.jobandtalent.com:

      1. High No-Show and Absentee Rates in Hourly Staffing
      ● Unreliable shift attendance remains one of the most pressing challenges for logistics,
      warehousing, and manufacturing operations, where absenteeism rates can average
      10-15% per shift (Bureau of Labor Statistics, 2024). These gaps drive up overtime
      costs by as much as 25% and force managers into reactive scheduling, often impacting
      service quality and on-time performance. For perishable goods, missed coverage can
      also lead to inventory spoilage costs, adding significant operational risk.
      ● Job&Talent addresses this problem through its Business platform, which combines
      real-time attendance tracking, geo-located clock-ins, and AI-driven shift reminders
      (Job&Talent Case Study: GLS Spain). These tools allow supervisors to intervene
      preemptively, reducing late arrivals and unplanned absences. After implementation,
      GLS Spain reported a material improvement in warehouse attendance rates, while
      U.S. logistics clients experienced up to a 20% reduction in absenteeism in the first six
      months of use (Job&Talent Press Release, 2024).
      ● Unlike traditional temp agencies that rely on manual check-ins and follow-up calls,
      Job&Talent delivers predictive attendance insights through centralized dashboards,
      enabling better labor planning. This proactive model reduces last-minute
      replacements, minimizes overtime spending, and provides higher operational
      predictability. Strategically, automating this attendance backbone helps customers cut
      administrative overhead by up to 15%, freeing teams to focus on capacity planning
      and workflow optimization rather than firefighting coverage issues.

      2. Difficulty Scaling Workforce Quickly During Peak Periods
      ● Seasonal surges and unexpected demand spikes—such as holiday e-commerce
      peaks or retail inventory pushes—often overwhelm HR teams, leaving them
      scrambling to source, vet, and onboard large numbers of workers in short timeframes. In
      logistics and retail, failing to meet peak labor needs can increase fulfillment costs by
      up to 30% and lead to on-time delivery rates dropping by 8-10% (DHL Peak Season
      Report 2024). Traditional staffing models, which rely on manual phone screening and
      slow paperwork processes, typically take 2-4 weeks to fill roles—too slow for volatile
      demand environments.
      ● Job&Talent solves this challenge through Clara, its proprietary AI-driven recruiter,
      capable of conducting thousands of candidate interviews in days via conversational
      chat and video workflows (Job&Talent Press Release, 2024). Case studies highlight that
      hundreds of vetted workers can be onboarded in under 48 hours, reducing
      time-to-fill by 70-80% versus traditional agencies (Job&Talent Case Study: U.S.
      Logistics Client). This automation spans sourcing, interviewing, and onboarding,
      enabling HR teams to scale workforce capacity without expanding headcount or
      paying significant overtime premiums.
      ● Operationally, this intelligence-driven model prevents supply chain bottlenecks, reduces
      reliance on last-minute high-cost staffing solutions, and helps enterprises protect
      margins during peak periods. Strategically, Job&Talent's speed and scale provide a
      competitive advantage for companies in logistics, warehousing, and retail, ensuring
      they can meet seasonal or sudden spikes in demand without compromising service
      quality.

      3. Complex Shift Planning and Poor Workforce Utilization
      ● Enterprises in logistics, warehousing, and manufacturing often rely on manual or
      spreadsheet-based shift planning, resulting in mismatched staffing levels, last-minute
      replacements, and costly under- or over-staffing. Industry research shows that poor labor
      planning can drive overtime costs up by 20-25% and cause labor utilization rates to
      fall below 70% (McKinsey Workforce Productivity Report 2024). These inefficiencies
      create a ripple effect: bottlenecks in production or fulfillment, elevated administrative
      workloads for planners, and higher attrition due to inconsistent schedules.
      ● Job&Talent addresses these challenges through AI-driven workforce planning that
      dynamically optimizes assignments based on skills, availability, and demand
      forecasts (Job&Talent Product Update 2024). Case studies highlight that warehouse
      operations in Spain achieved a 15% improvement in labor utilization and reduced
      scheduling-related administrative hours by 30% after adopting the platform. The
      system provides planners with real-time visibility into coverage gaps, labor cost
      projections, and risk alerts, enabling proactive adjustments.
      ● Unlike legacy staffing or VMS tools that rely on static templates or exports, Job&Talent
      embeds scheduling logic directly into its end-to-end workflow interface—integrating
      forecasting, hiring, attendance tracking, and bulk scheduling. This closed-loop
      approach reduces dependency on fragmented systems, minimizes last-minute
      replacements, and improves overall workforce reliability. For businesses with irregular
      operating hours or fluctuating volume, the result is smoother throughput, reduced
      operational disruptions, and measurable cost savings.

      4. Low Retention and High Staff Turnover in Hourly Workforces
      ● Hourly and seasonal workforces are notoriously unstable, with turnover rates
      exceeding 35-40% annually in sectors like logistics, warehousing, and retail (Bureau of
      Labor Statistics, 2024). This churn drives up cost-per-hire by 25-30% and erodes
      operational stability by forcing companies into continuous cycles of sourcing,
      onboarding, and training new staff. Beyond direct hiring costs, high turnover often leads
      to productivity losses of 10-15% as teams struggle to maintain consistent
      performance levels.
      ● Job&Talent addresses this challenge with a worker-engagement model built into its
      mobile platform. Features such as performance ratings, gamified milestones, and
      incentive notifications foster a sense of accountability and recognition (Job&Talent
      Product Overview, 2024). Customer testimonials highlight significant improvements in
      retention: logistics and retail clients report 15-20% reductions in mid-assignment
      dropouts and shorter onboarding cycles, improving workforce reliability and reducing
      operational friction (Job&Talent Case Study: EU Logistics Client).
      ● Unlike traditional agencies, which typically focus only on placement, Job&Talent provides
      continuous worker engagement—turning staffing into a more transparent and
      rewarding experience. Operationally, this model reduces failed assignments, cuts
      training costs, and builds a flexible core workforce that can be redeployed rather than
      replaced. Strategically, higher retention not only lowers recruiting expenses but also
      improves service consistency, giving enterprises in high-turnover sectors a competitive
      edge in workforce stability.

      5. Poor Real-Time Visibility into Workforce Metrics
      ● Many companies operating large, distributed workforces lack centralized, real-time
      visibility into critical labor data such as attendance, shift confirmations, clock-ins, and
      productivity ratings. Without live insights, managers are forced into reactive
      decision-making, which can increase last-minute staffing costs by 15-20% and lead
      to unplanned downtime across sites (Gartner Workforce Analytics Report 2024). For
      enterprises with hundreds of sites, these blind spots often delay interventions on
      emerging attendance or performance issues, impacting service quality and increasing
      operational risk.
      ● Job&Talent addresses this by embedding real-time operations dashboards directly
      into its platform, consolidating data from shift confirmations, geo-located clocking
      systems, and worker performance tracking (Job&Talent Product Update 2024).
      Clients, including national logistics providers, report the ability to view live KPIs
      across country, city, and site levels, enabling regional managers to intervene before
      issues escalate. Case studies highlight reductions in unplanned staff shortages by
      up to 18% and improved workforce reliability scores within the first six months of
      implementation (Job&Talent Case Study: U.S. Logistics Client).
      ● Unlike traditional staffing systems that rely on weekly reports or manual check-ins,
      Job&Talent functions as a single source of truth for workforce operations. This
      proactive visibility supports better-informed strategic resource planning, smoother
      coverage across fluctuating demand, and significantly reduced operational
      risk—particularly for enterprises managing complex, multi-site hourly labor
      environments.

      Ensure source has name. For example, if the source url is "www.bbcnews.com/news/some-article-name"
      then the name of the source should be "BBC News" and not "BBC News - Some Article Name".
      Please analyze the content and create a company analysis following this structure and dont forget the source for each point AND USE THE LANGUAGNE FROM THE LANGUAGE CODE: ${language_code}.
      IMPORTANT: Make sure that the link for sources are not shown in the actual analysis value but put in the source array, do not include citations in the analysis value.
      Return ONLY a valid JSON object in this exact format (no markdown formatting, no backticks, no extra words outside the json object):
      [
        {
          "title": "your title here",
          "value": "your analysis here (no links here!!)",
          "source": [ { "name": "name of source", "url": "your source url here" } ]
        }
      ]
    `;

    const benefitsPrompt = `
      You are a senior industry analyst at a top global consultancy.

      Your task: Identify 5 key benefits that ${company_website} delivers to its customers.

      MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language_code}.
      FOR EXAMPLE IF THE LANGUAGE CODE IS "sv" THEN THE TEXT SHOULD BE RETURNED IN SWEDISH AND IF THE LANGUAGE CODE IS "en" THEN THE TEXT SHOULD BE RETURNED IN ENGLISH AND SO ON.

      This is the summary of the company thats been generated:
      ${content}

      This it the raw content from the website:
      ${zenrowsContent}

      Primary sources:
      - Verifiable, publicly available information: press releases, case studies, customer testimonials,
      adoption metrics, credible news coverage, and investor reports.
      Secondary source:
      - The company's official website.

      For each benefit:
      - Length: ~250 words. Treat each as a mini-analysis suitable for a consulting deck.
      - Structure: Use a short, precise title, followed by 3 short paragraphs (max 3-4 sentences
      each) for scanability.
      - Mandatory data points: Include at least 3 quantified figures (e.g., productivity gains, cost
      savings, adoption rates, satisfaction scores, growth metrics, time-to-value) and name at least
      one customer or partner. Where possible, compare to industry benchmarks or traditional
      solutions.
      - Context: Clearly describe the benefit and why it matters (business or operational impact).
      - Differentiation: Explain how [Company Domain] delivers this benefit differently from
      competitors or legacy approaches.
      - Strategic implication: Briefly analyze how this benefit helps customers achieve broader
      business goals (e.g., profitability, compliance, scalability).

      Sources: Use multiple independent sources for each benefit. Provide source URL for
      every figure or named claim.

      No generic claims: Avoid vague statements or unverified marketing copy. Every assertion must
      be backed by evidence.

      Output format:
      Benefit 1: [Title]
      - [Paragraph 1: Context + core benefit + metrics]
      - [Paragraph 2: Supporting data + customer example + differentiation]
      - [Paragraph 3: Strategic implication + market context]
      Sources: [URL]
      (Repeat for all 5 benefits)

      Examples of Benefits for www.jobandtalent.com:
      1. Reliable, AI-Matched Talent Pool Improves Workforce Quality
      ● Enterprises in logistics, manufacturing, and retail often struggle to maintain consistent
      staffing quality at scale. Traditional agencies typically rely on manual resume screening
      and provide little post-placement support, leading to mismatches that erode productivity.
      Job&Talent addresses this by giving companies access to a pre-vetted talent pool of
      over 300,000 active workers, enhanced by AI-driven matching algorithms that
      continuously update profiles based on worker performance (Job&Talent Company Data,
      2024). This approach reduces time-to-fill by up to 70% compared to traditional staffing,
      enabling faster onboarding and minimizing productivity gaps.
      ● The impact is significant. For instance, GLS Spain reported a measurable improvement
      in warehouse reliability metrics and a 29% increase in workforce productivity after
      implementing Job&Talent's matching platform (Job&Talent Productivity Report 2024). By
      combining AI-powered screening with real-time worker feedback, Job&Talent improves
      match accuracy over time—helping companies achieve more predictable staffing
      outcomes even in high-churn environments like logistics.
      ● Strategically, this benefit allows enterprises to maintain service levels under volatile
      demand conditions while lowering costs associated with turnover and retraining.
      In sectors where fulfillment speed and accuracy are competitive differentiators,
      Job&Talent's AI-driven talent pool transforms staffing from a reactive process into a
      scalable, performance-oriented system.

      2. Expanded Job Access for Workers
      ● Traditional staffing models often present high barriers for hourly and temporary
      workers—requiring formal resumes, in-person interviews, and lengthy onboarding
      processes that disproportionately exclude first-time job seekers, migrants, and workers
      with non-traditional backgrounds. As a result, many capable candidates remain locked
      out of the labor market, contributing to underemployment in sectors that are already
      facing chronic labor shortages.
      ● Job&Talent removes these barriers by providing instant, mobile-first access to work
      opportunities without the need for a resume. Through its platform, over 1 million job
      placements are facilitated annually across 10+ countries, helping workers quickly
      access opportunities in logistics, warehousing, manufacturing, and retail (Job&Talent
      Annual Impact Report 2024). The onboarding process, which can be completed in under
      24 hours, allows workers to start earning almost immediately. According to an
      independent worker engagement study, Job&Talent's platform increases job
      accessibility by 40% for underserved groups, including migrants and low-income job
      seekers (Independent Worker Engagement Study 2024).
      ● Unlike traditional agencies that provide limited visibility or worker support
      post-placement, Job&Talent engages workers through features like real-time shift
      notifications, in-app payments, and performance tracking, making the employment
      journey more transparent and empowering. These features not only reduce friction but
      also foster a sense of accountability and belonging, encouraging workers to stay
      engaged longer.

      3. Increased Workforce Productivity and Operational Efficiency
      ● Enterprises that rely heavily on hourly labor often face misaligned staffing levels, high
      overtime costs, and inconsistent worker performance—issues that erode both
      productivity and profitability. According to McKinsey, inefficient labor allocation can
      reduce operational output by 10-15% in logistics and warehousing environments
      (McKinsey Workforce Productivity Report 2024). Job&Talent addresses these challenges
      by combining AI-driven workforce matching and dynamic scheduling to optimize
      assignments across skill sets, availability, and demand forecasts.
      ● This approach has led to measurable improvements: clients report productivity gains
      of up to 29% after adopting Job&Talent's platform, alongside a 15-20% reduction in
      overtime expenses (Job&Talent Productivity Report 2024). Customers such as XPO
      Logistics cite notable improvements in throughput and fulfillment accuracy when using
      Job&Talent to manage labor across multi-site operations. Unlike traditional staffing
      providers, which primarily focus on placements, Job&Talent integrates real-time data
      from attendance tracking, performance ratings, and workforce analytics to ensure
      ongoing optimization.
      ● Strategically, these operational efficiencies do more than reduce costs—they strengthen
      companies' ability to meet strict SLAs, maintain consistent service levels, and adapt
      quickly to demand volatility. By embedding workforce intelligence into day-to-day
      operations, Job&Talent transforms staffing from a reactive cost center into a predictive,
      performance-driven lever for operational excellence.

      4. Scalable Workforce Solutions Across Europe & Latin America
      ● Managing labor across multiple countries poses a significant challenge for
      enterprises—fragmented vendors, inconsistent compliance standards, and slow staffing
      cycles increase both operational risk and cost. Job&Talent solves this by operating in
      10+ countries, including key markets across Europe and Latin America, providing
      customers with a standardized, cross-border workforce solution (Job&Talent Global
      Expansion Press Release 2024). This enables multinationals to reduce vendor
      fragmentation by up to 40% and achieve 20% lower administrative overhead related
      to staffing management.
      ● Companies like DHL Spain use Job&Talent to streamline multi-country staffing for
      logistics projects, reporting a 50% reduction in time-to-staff for new sites compared to
      regional agencies. By integrating local compliance expertise with a unified digital
      platform, Job&Talent ensures consistent worker quality while navigating diverse
      regulatory frameworks. Unlike legacy agencies, which manage labor on a
      country-by-country basis, Job&Talent provides centralized dashboards and reporting,
      giving managers visibility into workforce performance across regions.
      ● This global scalability allows enterprises to expand quickly into new markets while
      maintaining workforce consistency, compliance, and operational agility. For companies
      under pressure to deliver cost-effective growth, Job&Talent offers a single-source
      staffing partner capable of scaling with their ambitions.
      Benefit 5: Lower Staffing Costs Through Automation
      ● Staffing operations are often weighed down by labor-intensive tasks like sourcing,
      screening, onboarding, scheduling, and payroll—each adding layers of cost and
      inefficiency. Job&Talent reduces these burdens through automation across the entire
      staffing lifecycle, from recruitment to payment, cutting overall staffing costs by
      15-25% (Job&Talent Efficiency Study 2024). For example, a major U.S. logistics client
      reduced recruiter headcount needs by 30% and cut overtime spending by 20% within six
      months of implementation.
      ● Unlike traditional agencies, which charge high placement fees and provide minimal
      post-hire support, Job&Talent delivers continuous workforce management through its
      integrated SaaS platform, improving both transparency and efficiency. Customers
      report significant time savings by automating routine processes like bulk scheduling,
      in-app onboarding, and real-time performance tracking, enabling HR teams to
      reallocate focus toward strategic initiatives rather than administrative tasks
      ● This cost reduction extends beyond immediate savings: by lowering dependency on
      manual processes and reducing worker turnover, Job&Talent creates a long-term
      staffing model that is leaner, more predictable, and more sustainable. For
      enterprises operating on tight margins, this automation-driven efficiency provides a
      measurable competitive edge.

      Ensure source has name. For example, if the source url is "www.bbcnews.com/news/some-article-name"
      then the name of the source should be "BBC News" and not "BBC News - Some Article Name".
      Please analyze the content and create a company analysis following this structure and dont forget the source for each point AND USE THE LANGUAGNE FROM THE LANGUAGE CODE: ${language_code}.
      IMPORTANT: Make sure that the link for sources are not shown in the actual analysis value but put in the source array, do not include citations in the analysis value.
      Return ONLY a valid JSON object in this exact format (no markdown formatting, no backticks, no extra words outside the json object):
      [
        {
          "title": "your title here",
          "value": "your analysis here (no links here!!)",
          "source": [ { "name": "name of source", "url": "your source url here" } ]
        }
      ]
    `;

    const promptList = [
      {
        prompt: uspPrompt,
        type: "unique_selling_points",
      },
      {
        prompt: problemSolvedPrompt,
        type: "problem_solved",
      },
      {
        prompt: benefitsPrompt,
        type: "benefits",
      },
    ];

    const analysisSchema = z.object({
      analysis: z.array(
        z.object({
          title: z.string(),
          value: z.string(),
          source: z.array(
            z.object({
              name: z.string(),
              url: z.string(),
            })
          ),
        })
      ),
    });

    const resultList = {};
    const promises = promptList.map(async ({ prompt, type }) => {
      let analysis;
      try {
        console.log("Sending request to OpenAI API...");
        const openAiResponse = await openai.responses.parse({
          model: "gpt-4.1-mini-2025-04-14",
          tools: [{ type: "web_search_preview" }],
          input: [{ role: "user", content: prompt }],
          max_output_tokens: 4096,
          text: {
            format: zodTextFormat(analysisSchema, "analysis"),
          },
        });
        analysis = openAiResponse.output_parsed.analysis;
        console.log("OpenAI analysis:", analysis);
        console.log("Successfully analyzed content with OpenAI");
      } catch (error) {
        console.log("Error OpenAI:", error);
        console.log("Sending request to Anthropic API...");
        const client = new Anthropic({
          apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
        });
        const anthropicResponse = await client.messages.create({
          model: "claude-3-7-sonnet-20250219",
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        });
        analysis = JSON.parse(anthropicResponse.content[0].text);
        console.log("Anthropic analysis:", analysis);
        console.log("Successfully analyzed content with Anthropic");
      }

      resultList[type] = analysis;
    });

    await Promise.all(promises);

    console.log("Result list:", resultList);

    const { error: updateError } = await supabase
      .from("campaign_progress")
      .update({
        step_3_result: resultList,
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
        data: resultList,
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
