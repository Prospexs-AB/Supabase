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

/**
 * Cleans a domain by removing protocol (http://, https://) and www prefix
 * @param domain - The domain to clean
 * @returns Cleaned domain without protocol and www
 */
const cleanDomain = (domain: string): string => {
  if (!domain) return "";

  // Remove protocol (http:// or https://)
  let cleaned = domain.replace(/^https?:\/\//, "");

  // Remove www prefix
  cleaned = cleaned.replace(/^www\./, "");

  // Remove trailing slash
  cleaned = cleaned.replace(/\/$/, "");

  return cleaned;
};

// Helper function to clean JSON responses from OpenAI
const cleanJsonResponse = (response: string): string => {
  let cleaned = response.trim();

  // Handle cases where there's text before the JSON
  const jsonMatch = cleaned.match(
    /```(?:json)?\s*(\[[\s\S]*?\]|\{[\s\S]*?\})\s*```/
  );
  if (jsonMatch) {
    return jsonMatch[1];
  } else if (cleaned.startsWith("```json")) {
    return cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    return cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  return cleaned;
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

    const { data: jobData, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("job_name", "lead-insights")
      .eq("status", "waiting_for_next_step")
      .eq("job_step", 4)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (jobError) {
      console.log("Error getting job:", jobError);
      return new Response(JSON.stringify({ error: jobError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    console.log(
      `===== Starting job processing for job id: ${jobData.id} =====`
    );

    const { error: firrstUpdateJobError } = await supabase
      .from("jobs")
      .update({ status: "processing" })
      .eq("id", jobData.id);

    if (firrstUpdateJobError) {
      console.error(`Error updating job ${jobData.id}:`, firrstUpdateJobError);
      return new Response(
        JSON.stringify({ error: firrstUpdateJobError.message }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const { campaign_id, progress_data } = jobData;

    console.log("Prosessing job for campaign:", campaign_id);

    const { data: campaignData, error: campaignError } = await supabase
      .from("campaigns")
      .select("*")
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

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    const {
      step_1_result: { language },
    } = progressData;

    const { company_name: lead_company_name, linkedin_url: lead_linkedin_url } =
      progress_data;
    const { businessInsights } = progress_data.insights;
    const updatedLead = JSON.parse(JSON.stringify(progress_data));

    const conversationStarterPrompt = `
      You are a senior B2B strategist at a top-tier consultancy preparing for high-level outreach or
      networking with a senior stakeholder (VP, C-level, or strategic buyer).
      Prospexs has already analyzed the target company's:
      - Product or service
      - Position in the market
      - Business model and GTM strategy
      - Challenges, growth areas, and recent developments

      These are the challenges that Prospexs has identified from the target company in JSON format:
      ${JSON.stringify(businessInsights.challengesWithSolutions, null, 2)}

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

      IMPORTANT! RETURN THE RESPONSE IN A JSON FORMAT USING THE FORMAT BELOW. DO NOT INCLUDE ANY EXPLANATORY TEXT, MARKDOWN FORMATTING, OR ADDITIONAL CONTENT OUTSIDE THE JSON STRUCTURE.

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

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
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

    const {
      step_2_result: { company_name },
    } = progressData;
    const { company_website } = campaignData;

    const commonalitiesPrompt = `
      You are a senior B2B strategist at a top global consultancy.

      Prospexs has already analyzed the business models, value propositions, and go-to-market
      strategies of both companies listed below.

      Your task is to identify 4 deep, strategic similarities between the two companies. These
      similarities should help the user from this company: ${company_name} with website: ${company_website} build trust, relevance, or credibility when reaching
      out to ${lead_company_name} with website: ${progress_data.company_website}.

      Focus on real, non-obvious business commonalities, such as:
      - Monetization model (e.g. usage-based, seat-based)
      - Customer acquisition strategy (e.g. PLG, direct sales, ecosystem-led)
      - Target buyer persona (e.g. devs, recruiters, CFOs)
      - Technical architecture (API-first, ecosystem integrations, modularity)
      - Internationalization strategy
      - Unit economics (e.g. high NRR, expansion revenue, LTV/CAC logic)

      Use data or market logic where possible (e.g. based on company size, funding stage, product
      motion, reported NRR benchmarks, etc.) and make sure that the data is relevant to the company
      and not other companies not mentioned in the input data.
      Ensure the similarities are relevant to the user and leads company and dont halucinate any data.

      Format each similarity as a short, insight-rich paragraph. Write with the tone of a strategist or
      investor—not a marketer.
      Do not include generic similarities like "both are SaaS companies." Focus on what's strategically
      interesting or commercially relevant.

      Important: Only use information that is explicitly available in the input data.
      Do not assume, invent, or guess details about the lead, their company, or their situation.
      If no relevant information is found, state that clearly.
      You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
      and always label them clearly as general context, not lead-specific insight.

      IMPORTANT! RETURN THE RESPONSE IN A JSON FORMAT USING THE FORMAT BELOW. DO NOT INCLUDE ANY EXPLANATORY TEXT, MARKDOWN FORMATTING, OR ADDITIONAL CONTENT OUTSIDE THE JSON STRUCTURE.

      Example Detected Similarities Between www.teamtailor.com and www.stripe.com:

      Example Similarities 1: ExamUsage-Based, Scalable SaaS Models Designed for High LTV
      Stripe and Teamtailor both monetize through usage-aligned pricing models—Stripe via
      transaction volume and modular APIs, Teamtailor via seats, brand modules, and usage tiers.
      This results in high NRR (net revenue retention)—a critical SaaS metric. Stripe's NRR has been
      estimated north of 125%, while Teamtailor's customer retention and upsell motion (across
      10,000+ companies) reflects similar unit economics: land small, expand over time. Both are
      structured to grow with their customers' success.

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

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
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

    const insightsPrompt = `
      You are a senior business analyst at a top-tier consultancy.

      Your task is to generate 4 recent and insight-rich updates about ${lead_company_name}, focused on product development, strategic direction, or key company moves.

      Each insight should:
      - Be based on publicly available sources (e.g. blog posts, press releases, product pages, news articles, update logs)
      - Be 3-5 sentences long
      - Include business context and explain why the update matters strategically (not just what happened)
      - Avoid speculation—only use confirmed developments or directly attributable content
      - End with a reliable source link (company blog or press, not random third parties)

      Do not include generic company overviews or old funding news. Focus on product launches,
      feature updates, platform changes, new capabilities, or go-to-market shifts from the last 6-12
      months.

      Important: Only use information that is explicitly available in the input data.
      Do not assume, invent, or guess details about the lead, their company, or their situation.
      If no relevant information is found, state that clearly.
      You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
      and always label them clearly as general context, not lead-specific insight.

      Example Insights About X for www.stripe.com

      Example Insights about X 1: Stripe's AI Foundation Model Enhances Payment Intelligence - In
      April 2025, Stripe announced the deployment of a proprietary AI foundation model trained on
      over 100 billion payment events. This model, already integrated into Radar, has improved fraud
      detection rates by 64% for card-testing attacks. More significantly, it signals Stripe's broader
      move toward intelligent infrastructure—not just for security, but also for optimizing checkout
      flows, predicting conversion behavior, and powering real-time decisions across the platform.
      Stripe is positioning this model not as a standalone AI feature, but as a core enabler of every
      part of the payment lifecycle.

      Example Insights about X 2: Stablecoin Financial Accounts Expand Global Reach - Stripe
      launched Stablecoin Financial Accounts, giving businesses the ability to hold and move money
      in USDC across 100+ markets. This unlocks faster global transfers, hedges against local
      currency volatility, and reduces dependence on traditional banking rails. Especially for platforms
      operating in emerging markets or with remote contractors, this could become a key advantage
      in cost control and payment flexibility. The move deepens Stripe's position as a global treasury
      layer—not just a processor.

      Example Insights about X 3: Stripe Orchestration Introduces Multi-PSP Routing Flexibility -
      The new Stripe Orchestration product gives merchants the ability to route payments between
      multiple providers within the Stripe environment, including fallback logic and smart retries. For
      global businesses, this solves a growing need for redundancy and optimization without requiring
      deep engineering investments. It's also a strategic play by Stripe to stay embedded even in
      setups that traditionally favored PSP diversification.

      Example Insights about X 4: Optimized Checkout Suite Delivers Real-Time Personalization
      with AI - Stripe's checkout product has been enhanced with AI that adjusts checkout layout,
      payment methods, and UI components in real time—based on location, device, past behavior,
      and over 100 contextual signals. Early results show significant uplifts in conversion, particularly
      for mobile and international traffic. This pushes Stripe deeper into the merchant-side
      optimization stack—blurring the lines between infrastructure and customer experience.

      Example Insights About X for www.teamtailor.com

      Example Insights about X 1: AI-Driven Co-pilot Enhances Recruitment Efficiency -
      Teamtailor's introduction of the AI-powered Co-pilot marks a significant advancement in
      streamlining recruitment processes. Co-pilot assists recruiters by automating tasks such as
      drafting job advertisements, summarizing resumes, and suggesting interview questions tailored
      to specific roles. This integration of AI not only accelerates the hiring process but also ensures
      consistency and reduces manual errors, allowing HR teams to focus more on strategic
      decision-making and candidate engagement.

      Example Insights about X 2: Comprehensive Onboarding Module Bridges Pre-Hire to Day
      One - Recognizing the importance of a seamless transition from candidate to employee,
      Teamtailor has launched a robust onboarding feature. This module enables HR teams to
      automate tasks, assign responsibilities across departments, and centralize essential documents
      and communications. By customizing onboarding templates for different roles or departments,
      organizations can ensure a consistent and welcoming experience for new hires, thereby
      improving retention rates and employee satisfaction from the outset.

      Example Insights about X 3: Enhanced Skills-Based Hiring with Integrated Evaluation Tools -
      In response to the growing emphasis on competency-based recruitment, Teamtailor has
      upgraded its evaluation features. The platform now offers a unified evaluation system that
      combines scorecards, interview kits, and job match scores, allowing recruiters to assess
      candidates based on specific skills and traits. This structured approach minimizes unconscious
      bias and ensures that hiring decisions are grounded in objective criteria, aligning with best
      practices in modern talent acquisition.

      Example Insights about X 4: Dynamic Application Forms Improve Candidate Experience -
      Teamtailor has introduced conditional questions in application forms, enabling a more
      personalized and efficient candidate experience. By tailoring subsequent questions based on
      previous answers, applicants are presented with relevant queries, reducing redundancy and
      form fatigue. This dynamic approach not only enhances the user experience but also ensures
      that recruiters gather pertinent information, streamlining the screening process and improving
      the quality of applicant data.

      IMPORTANT: MUST prioritize public sources (news, industry reports, credible outlets) over company websites.
      Try to not use the same source for multiple points.
      If there are no public sources, then use the company website, THERE MUST BE A SOURCE.

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
      IMPORTANT: Make sure that the link for sources are not shown in the actual analysis description.
      IMPORTANT: Return the answers in the following JSON format:
      [
        {
          "title": "The title of the insight will be here",
          "description": "Description of the insight",
          "source": ["Source 1", "Source 2", "Source 3"],
        },
        {
          "title": "The title of the insight will be here",
          "description": "Description of the insight",
          "source": ["Source 1", "Source 2", "Source 3"],
        }
      ]
    `;

    const discoveryPrompt = `
      You are a senior B2B strategist and solutions consultant at a top global firm.

      Prospexs has already identified:
      - The company facing the challenge (${lead_company_name})
      - The strategic challenges they're dealing with (${JSON.stringify(
        businessInsights.challengesWithSolutions,
        null,
        2
      )})
      - The solution provider offering a relevant product or service (${company_name})
      - The potential solution and impact already mapped to each challenge

      Your task is to generate 5 sharp, strategic discovery questions for each challenge that the
      solution provider should ask the target company.

      For each question, include:
      - The exact question (clear and consultative in tone)
      - A short explanation (1-2 sentences) of why this question matters and what it will uncover

      These questions should:
      - Sound like they're coming from a seasoned enterprise AE, strategist, or product lead
      - Help uncover internal context, blockers, or workflows tied to the challenge
      - Prepare the provider to better scope, pitch, or implement their solution

      Avoid generic questions (like "What keeps you up at night?"). Make every question feel
      customized to the company's situation and the solution's capabilities.

      Important: Only use information that is explicitly available in the input data.
      Do not assume, invent, or guess details about the lead, their company, or their situation.
      If no relevant information is found, state that clearly.
      You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
      and always label them clearly as general context, not lead-specific insight.

      Example Discovery Questions for www.teamtailor.com

      Example Discovery Questions for X 1:

      Challenge 1: Standing Out in a Crowded ATS Market:
      Teamtailor is in a saturated market with competitors bundling AI, sourcing, and CRM features.
      Differentiation is getting harder - especially when price pressure and feature parity are
      increasing.

      Stripe's Discovery Questions (and Why They Matter):

      1. "What are the most common reasons your prospects choose a competitor over
      Teamtailor today?"
      Helps identify where Teamtailor may be perceived as lacking — price, features,
      enterprise depth, or brand.

      2. "Have you run any pricing experiments or packaging changes in the last 12
      months?"
      If they haven't, Stripe could offer flexible billing infrastructure to support rapid testing
      of pricing models (usage-based, modular, role-based).

      3. "How do you currently align pricing with perceived customer value across SMB
      vs. enterprise?"
      Reveals if Stripe's billing tools can help match value delivery with revenue capture
      (e.g. ARPA lift via tiering).

      4. "How often do you iterate on GTM messaging to reflect product evolution?"
      Could inform whether Stripe's insight tooling could help Teamtailor adjust
      product-market positioning faster.

      5. "Are you tracking expansion revenue or usage data to inform how you package or
      sell features?"
      If not, Stripe's tools can help track feature adoption and power smarter monetization
      decisions.

      Example Discovery Questions for X 2:

      Challenge 2: Scaling Into Enterprise Without Losing Simplicity
      Teamtailor wants to move upmarket, but enterprise deals bring long sales cycles, compliance
      demands, and billing complexity—while they still need to preserve a UX-friendly core product.

      Stripe's Discovery Questions:

      1. "What friction points have you encountered in procurement or compliance when
      selling to larger organizations?"
      Uncovers opportunity for Stripe to reduce procurement delays via localized invoicing,
      tax handling, or payment terms.

      2. "How are enterprise clients currently billed differently from your core SMB base?"
      Reveals if Stripe Billing or Invoicing can streamline complex enterprise payment
      plans or pricing agreements.

      3. "Do you currently offer contract flexibility (e.g. usage-based pricing or annual
      commits) for large clients?"
      Stripe can help Teamtailor support different contract models within a single billing
      stack.

      4. "Are you seeing demand for integrations with internal finance systems (e.g.
      Netsuite, SAP, Workday) during the sales cycle?"
      Indicates whether Stripe's enterprise APIs or financial reporting features can drive
      stickiness or accelerate implementation.

      5. "How do you maintain product simplicity while adapting to custom enterprise
      workflows?"
      Opens a conversation around Stripe's modular product architecture—only offer
      what's needed, when it's needed.

      Example Discovery Questions for X 3:

      Challenge 3: Falling Behind in AI-Driven Talent Tech Arms Race
      Competitors are embedding AI in matching, outreach, and screening. Teamtailor is strong in UX,
      but risks falling behind if it doesn't demonstrate innovation in hiring intelligence.

      Stripe's Discovery Questions:

      1. "What parts of the hiring journey are you actively exploring for AI-driven
      optimization?"
      Pinpoints where AI is being explored (e.g. candidate matching vs. interview scoring)
      and where Stripe data tools may support monetization.

      2. "Do you expect to charge for future AI-powered features, or bundle them into
      existing tiers?"
      Helps Stripe shape a billing model (add-on, usage-based, bundled) and prepare the
      infrastructure.

      3. "What metrics would define success for an AI feature in your platform—efficiency,
      accuracy, NPS?"
      Reveals Teamtailor's north star for innovation, and how Stripe's analytics tooling can
      help validate or monetize those outcomes.

      4. "How do you currently experiment with feature rollouts across different user
      segments?"
      Shows if Stripe's billing logic can support gated rollouts, feature flags, or user-level
      feature access.

      5. "Is there a monetization or revenue model attached to your AI roadmap today?"
      If not, Stripe can offer strategy + infrastructure to capture future AI value from day
      one.

      Example Discovery Questions for X 4:

      Challenge 4: Complexity in International Expansion
      Teamtailor is active in 90+ countries. That means multi-currency support, tax compliance,
      localization, and financial operations complexity—all of which Stripe is built to simplify.

      Stripe's Discovery Questions:

      1. "Which geographies are currently the most painful in terms of financial operations
      or compliance?"
      Lets Stripe recommend localized billing, currency support, and compliance services
      based on Teamtailor's priority markets.

      2. "Do you have internal resources managing tax and VAT handling across
      markets—or is it mostly manual?"
      Stripe Tax could immediately reduce overhead here if they're handling this with
      spreadsheets or external advisors.

      3. "Are you offering local payment methods in every region where you operate?"
      Stripe supports 50+ methods; this reveals if they can help increase conversion or
      reduce cart abandonment.

      4. "What's your approach to pricing localization—do you adapt plans by market?"
      Stripe's flexible pricing tools could let them dynamically adapt pricing based on
      region, without custom dev work.

      5. "How do you forecast or report on revenue by country or currency?"
      Stripe can help simplify multi-currency revenue recognition and offer richer financial
      dashboards, especially for CFO-level reporting.

      IMPORTANT: MUST prioritize public sources (news, industry reports, credible outlets) over company websites.
      Try to not use the same source for multiple points.
      If there are no public sources, then use the company website, THERE MUST BE A SOURCE.

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
      IMPORTANT: Return the answers in the following JSON format:
      [
        {
          "challenge": "The challenge that the solution provider should ask the target company about",
          "discovery_questions": [
            {
              "question": "The title of the discovery question will be here",
              "answer": "Description of the discovery question",
            },
            {
              "question": "The title of the discovery question will be here",
              "answer": "Description of the discovery question",
            }
          ]
        }
      ]
    `;

    const whyNotPrompt = `
      You are a senior GTM strategist and industry analyst at a top global consultancy.

      Prospexs has already identified:
      - The company facing strategic challenges (${lead_company_name})
      - The challenges they're dealing with:
      ${businessInsights.challengesWithSolutions
        .map(
          (challenge) => `
          challenge title: ${challenge.title}
          challenge description: ${challenge.description}
        `
        )
        .join("\n")}
      - The solution provider (${company_name}) and what they offer:
      ${businessInsights.challengesWithSolutions
        .map(
          (challenge) => `
          solution title: ${challenge.solutions.map(
            (solution) => solution.solutionTitle
          )}
          solution description: ${challenge.solutions.map(
            (solution) => solution.solutionDescription
          )}
        `
        )
        .join("\n")}

      Your task is to generate a "Why Now?" analysis explaining why the solution provider should
      reach out and engage the company right now.

      For each challenge, explain:
      - Why this challenge is increasing in urgency right now (e.g. trends, competitor moves,
      regulatory shifts)
      - How the solution provider is uniquely positioned to address it

      - Include data points, industry insights, and analyst predictions (e.g. G2 trends, Gartner
      forecasts, growth benchmarks)

      Conclude with a short summary that ties together urgency, fit, and impact.

      Use a clear, confident tone — like you're writing a deal brief for a senior sales or partnerships
      leader.

      Important: Only use information that is explicitly available in the input data.
      Do not assume, invent, or guess details about the lead, their company, or their situation.
      If no relevant information is found, state that clearly.
      You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
      and always label them clearly as general context, not lead-specific insight.

      Example Why Now Insights for www.teamtailor.com

      Why Now Example 1: The ATS market is hitting feature parity—pricing innovation is becoming
      the new battleground.
      According to G2 and Productboard, over 60% of mid-market ATS buyers now consider “pricing
      model flexibility” a top decision factor, up from 34% in 2022. Platforms like Ashby and Lever are
      moving toward modular or usage-based pricing to reflect actual customer value. Teamtailor,
      which has historically leaned on flat-rate simplicity, risks commoditization unless it can
      differentiate on how it sells—not just what it sells. Stripe's flexible billing APIs and product-tiered
      infrastructure can enable Teamtailor to launch, A/B test, and localize monetization models
      without a backend overhaul.

      Why Now Example 2: Teamtailor's enterprise expansion will strain their current finance and
      billing stack.
      As more ATS vendors like Workable and SmartRecruiters shift toward enterprise accounts (with
      ARPA > $20K), buyer expectations around procurement infrastructure have hardened.
      Enterprise clients now demand things like ACH, SEPA, localized invoicing, VAT-compliant tax
      handling, and contract-based billing terms. If Teamtailor continues to grow in markets like
      Germany, the UK, and the Nordics, a modernized billing and finance ops layer is no longer
      optional. Stripe's enterprise-grade billing, invoicing, and tax stack can be deployed
      modularly—giving them global readiness without enterprise bloat.

      Why Now Example 3: The AI race in HR tech is accelerating—and monetization is lagging
      behind.
      Gartner predicts that by 2026, over 75% of hiring platforms will embed AI scoring, filtering, and
      auto-matching tools. But only 18% of them have a revenue model tied to these features.
      Teamtailor has already launched AI-driven workflows and evaluation tools—but it hasn't yet
      attached monetization logic. Stripe can help Teamtailor price these features as add-ons,
      usage-based modules, or higher-tier differentiators, turning AI investment into scalable revenue.

      Why Now Example 4: International expansion is increasing operational drag—and Stripe can
      remove it.
      Teamtailor now operates in 90+ countries. This means more currencies, localized payment
      methods, tax rules, and region-specific compliance headaches. Companies that don't solve for
      this early see slower rollout velocity and higher cost of finance ops. Stripe supports payments in
      135+ currencies, automates tax compliance across 40+ markets, and offers programmable
      payouts—letting Teamtailor expand faster without increasing headcount in back-office teams.

      Example Why Now Insights for www.remote.com

      Why Now Example 1: Navigating Global Compliance and Tax Complexity
      Remote is live in 180+ countries and growing fast—but this scale brings enormous financial
      compliance pressure. As regulators crack down on contractor misclassification and cross-border
      tax compliance, EOR and global payroll companies are under the microscope. In 2024, both
      Deel and Papaya Global faced intensified audits in high-risk markets. Remote must minimize
      exposure while maintaining speed. Stripe's tax and billing stack automates region-specific rules,
      cutting compliance overhead by up to 30% and enabling safe expansion into new markets
      without headcount bloat.

      Why Now Example 2: Slowing Onboarding and Conversion Velocity
      With competitors like Rippling and Deel investing heavily in onboarding UX and speed-to-hire,
      Remote risks falling behind. According to OpenView's 2024 SaaS benchmark, reducing
      onboarding friction increases activation rates by 25-40% in B2B platforms. Stripe's modular
      onboarding stack lets Remote securely verify users, accept payments globally, and automate
      account creation—all while staying compliant. The longer Remote delays UX-level
      optimizations, the more volume shifts to faster competitors.

      Why Now Example 3: Increasing Risk in Contractor Payouts and Regulatory Scrutiny
      The freelance and contractor economy is booming—but so is the risk. Inconsistent payout logic
      and KYC gaps can trigger financial and legal headaches, especially in markets like India, Brazil,
      and Nigeria. With platforms under pressure to pay faster and more transparently, Stripe's payout
      stack offers programmable wallets, automated AML/KYC, and real-time transfers. Remote can
      stay ahead of scrutiny and deliver a best-in-class contractor experience—before local fintech
      competitors fill that gap.

      Why Now Example 4: Managing Financial Complexity at Global Scale
      Remote is no longer just a startup—it's infrastructure for other companies' infrastructure. That
      means more expectations around stable, transparent financial systems. As they expand,
      operating costs grow linearly unless finance infrastructure improves. Stripe helps break that
      tradeoff—offering instant support for 135+ currencies, 50+ local payment methods, and clean
      financial data by region. If Remote waits, it risks ballooning ops costs and missing expansion
      targets in regions where payment preferences matter.

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
      IMPORTANT: Return the answers in the following JSON format:
      [
        {
          "challenge": "The challenge that the solution provider should ask the target company about",
          "why_now": "The why now analysis for the challenge",
        },
        {
          "challenge": "The challenge that the solution provider should ask the target company about",
          "why_now": "The why now analysis for the challenge",
        }
      ]
    `;

    const awardsPrompt = `
      You are a senior strategist specializing in analyzing LinkedIn profiles to uncover business
      context, signals, and intent.

      Your task is to review the following LinkedIn profile: ${lead_linkedin_url} data and extract a list of
      clear, concise, and notable achievements, such as:
      - Awards (e.g. “Leader of the Year 2022”)
      - Major milestones (e.g. “Promoted 3 times in 5 years”, “Worked at X for 10+ years”)
      - Public recognitions (e.g. “Featured in Forbes 30 Under 30”)
      - Career longevity highlights (e.g. “8 years at Google”, “Built first APAC office”)
      - Certifications only if they are prestigious or well-known (e.g. PMP, CFA, Google Developer
      Expert)

      This is the linkedin url: ${lead_linkedin_url}
      This is the linkedin data: {linkedin_data}

      Output should be a bullet point list, with 1-2 lines per item max.
      Do not include generic responsibilities or role descriptions. Only include standout achievements
      that differentiate this person from others.

      Use the tone of a high-end recruiter or executive search analyst summarizing why this person is
      notable.

      Important: Only use information that is explicitly available in the input data.
      Do not assume, invent, or guess details about the lead, their company, or their situation.
      If no relevant information is found, state that clearly.
      You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
      and always label them clearly as general context, not lead-specific insight.

      Example Award & Recognitions About X:
      Example Award & Recognition 1: Winner of 'Leader of the Year' at Telia Company in 2022.
      Example Award & Recognition 2: Promoted 3 times in 6 years at Klarna — from Analyst to
      Head of Growth.
      Example Award & Recognition 3: Named in Forbes 30 Under 30 - Technology, Europe list.
      Example Award & Recognition 4: Spent 10+ years at Ericsson.
      Example Award & Recognition 5: Built and scaled Spotify's first LATAM marketing team from
      0 to 40 people.
      Example Award & Recognition 6: Selected for McKinsey & Company's internal 'Top 1%
      Future Partner' program.
      Example Award & Recognition 7: Featured speaker at Web Summit 2024 on AI in
      e-commerce.
      Example Award & Recognition 8: Certified Google Developer Expert in Machine Learning
      since 2021.
      Example Award & Recognition 9: Led the product team behind the 'App of the Year' at the
      Swedish Tech Awards (2022).
      Example Award & Recognition 10: Received CEO's Performance Award at H&M Group.

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
      IMPORTANT: Return the answers in the following JSON format:
      [
        {
          "award": "The award or recognition",
          "description": "The description of the award or recognition",
        }
      ]
    `;

    const interestsPrompt = `
      You are a senior strategist specializing in analyzing LinkedIn profiles to uncover business
      context, signals, and intent.
      Analyze the following LinkedIn profile: ${lead_linkedin_url} data and extract a list of personal
      interests and hobbies.

      This is the linkedin url: ${lead_linkedin_url}
      This is the linkedin data: {linkedin_data}

      Focus on:
      - What they mention in their "About" section
      - Volunteering, extracurriculars, or activity feed
      - Any personal mentions in job descriptions (e.g. "Outside of work I...")
      Return the output as a bullet-point list of short, lowercase items, such as:
      - yoga
      - hiking
      - sci-fi
      - climate tech
      - volunteering
      Do not use full sentences. Do not add descriptions or context.
      Only include clear, humanizing interests that reflect the person's personality or lifestyle.
      Important: Only use information that is explicitly available in the input data.
      Do not assume, invent, or guess details about the lead, their company, or their situation.
      If no relevant information is found, state that clearly.
      You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
      and always label them clearly as general context, not lead-specific insight.

      Example Interests & Hobbies:
      - Trail running
      - Youth football coaching
      - Sci-fi books
      - Volunteering
      - Language learning
      - Startup mentoring
      - Yoga
      - Climate tech
      - Productivity apps
      - Hiking & camping

      If there are no interests or hobbies, return an empty array.

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
      IMPORTANT: Return the answers in the following JSON format:
      [
        "interest 1",
        "interest 2",
        "interest 3",
        "interest 4"
      ]
    `;

    const educationPrompt = `
      You are a senior strategist specializing in analyzing LinkedIn profiles to uncover business
      context, signals, and intent.

      Analyze the following LinkedIn profile: ${lead_linkedin_url} data and extract a list of the educational
      institutions this person has attended.

      This is the linkedin url: ${lead_linkedin_url}
      This is the linkedin data: {linkedin_data}

      Focus only on:
      - Universities
      - Business schools
      - Colleges
      - Recognized institutions of higher education

      Output format:
      - One bullet per school
      - Only include school names (e.g. "Lund University", "KTH Royal Institute of Technology")
      - No degrees, dates, or locations unless explicitly requested

      Important: Only use information that is explicitly available in the input data.
      Do not assume, invent, or guess details about the lead, their company, or their situation.
      If no relevant information is found, state that clearly.
      You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
      and always label them clearly as general context, not lead-specific insight.

      Example Interests & Hobbies:
      - Stockholm University
      - Lund University
      - Uppsala University
      - KTH Royal Institute of Technology
      - Chalmers University of Technology
      - London School of Economics
      - INSEAD
      - Harvard Business School
      - Copenhagen Business School
      - HEC Paris

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
      IMPORTANT: Return the answers in the following JSON format:
      [
        "school 1",
        "school 2"
      ]
    `;

    const relevantInsightsPrompt = `
      You are a senior strategist specializing in analyzing LinkedIn profiles to uncover business
      context, signals, and intent.

      Your job is to uncover relevant, human insights about a specific lead based on their LinkedIn
      profile and broader digital footprint (including posts, interviews, articles, public activity, and
      interactions).

      Your goal is to help a sales or partnership team quickly understand:
      - What this person cares about
      - What they're likely focused on right now
      - What topics, events, or trends they're publicly engaging with
      - Any subtle personal interests or behavioral cues that can make outreach or meetings
      more relevant

      Input sources may include:
      - LinkedIn bio, work history, posts, shares, comments, likes
      - Interviews, panels, podcasts
      - Company articles they're quoted in
      - Conferences or events they've attended
      - Anything else from their public presence

      This is the linkedin url: ${lead_linkedin_url}
      This is the linkedin data: {linkedin_data}

      Keep it tight, real, and usable in a cold email or intro call.

      Important: Only use information that is explicitly available in the input data.
      Do not assume, invent, or guess details about the lead, their company, or their situation.
      If no relevant information is found, state that clearly.
      You may use industry benchmarks, role-specific patterns, or known trends only as a fallback —
      and always label them clearly as general context, not lead-specific insight.

      Example Relevant Insights:
      - Title: Launch of AI features
      Recently posted about the launch of their AI-driven onboarding feature and shared a
      case study on reducing churn—likely focused on activation and retention right now.
      Attended Slush 2024 and shared photos from the 'Future of Work' stage—shows interest
      in workplace innovation. Also reposted multiple content pieces from Deel and Remote,
      suggesting they follow global employment trends closely.

      - Title: Team Culture
      Often comments on posts about team culture and internal communication. In a podcast
      last year, they mentioned scaling pains as a first-time VP—likely sensitive to tools that
      reduce internal friction. Also shared a personal post about running their first
      ultramarathon—possible tie-in to resilience, discipline, or health-focused narratives.

      - Title: Female Leadership & Diversity
      Liked a number of posts related to female leadership and diversity hiring in the past
      month. Was featured in a 'Meet the CMO' interview where she talked about the shift
      toward data-led decision-making in marketing. Attended INBOUND 2023 and tagged
      three product leaders from her team - possibly open to solutions that tighten
      marketing-product alignment.

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
      IMPORTANT: Return the answers in the following JSON format:
      [
        {
          "title": "The title of the insight",
          "description": "The description of the insight",
        },
        {
          "title": "The title of the insight",
          "description": "The description of the insight",
        },
      ]
    `;

    const {
      step_5_result: { linkedin_url: user_linkedin_url, linkedin_profile },
    } = progressData;

    const similaritiesPrompt = `
      You are a senior strategist specializing in analyzing LinkedIn profiles to uncover business
      context, signals, and intent.
      Your task is to identify genuine similarities between two people based on their LinkedIn
      profiles:
      - X = the user of Prospexs (Linkedin URL: ${user_linkedin_url})
      - Y = the lead (Linkedin URL: ${lead_linkedin_url})

      This is the linkedin data for "X" (the user of Prospexs): ${linkedin_profile}
      This is the linkedin data for "Y" (the lead): {linkedin_data}

      You will be given both LinkedIn profiles (including bios, work history, posts, education, interests,
      etc.).
      Your goal is to surface credible and natural connection points that the user could use to build
      rapport, open a conversation, or establish common ground.
      These may include:
      - Shared industries, roles, or company types
      - Similar career paths or titles
      - Common tools, technologies, or methodologies
      - Overlapping events, certifications, or regions
      - Shared causes, interests, or values (if publicly stated)

      Output Instructions:
      - List 4 high-quality similarities.
      - Use complete sentences.
      - Avoid generic or forced connections (e.g. “both work in tech” unless meaningful)
      - If no clear similarities are found, say so and do not guess.

      Important: Only use information that is explicitly available in the input data.
      Do not assume, invent, or guess details about the lead, their company, or their situation.
      If no relevant information is found, state that clearly. You may use industry benchmarks,
      role-specific patterns, or known trends only as a fallback — and always label them clearly as
      general context, not lead-specific insight. If no direct similarities are found, clearly state that —
      then provide 4 relevant role-based or industry-level commonalities based on their current titles,
      company types, or sectors.

      Clearly label these as professional context overlaps, not personal insights.

      Example Similarities Between X & Y:
      - Both X and Y have held commercial leadership roles at early-stage SaaS companies
      targeting mid-market clients. Their profiles reflect a strong bias toward product-led
      growth, with multiple posts referencing self-serve onboarding, usage-based pricing, or
      activation metrics.
      - While they've never worked at the same company, both transitioned from individual
      contributor roles into team lead positions during high-growth phases—likely sharing
      similar experiences around team-building under pressure.
      - Both X and Y are based in Europe but lead globally distributed teams. X is currently
      managing a remote RevOps team across 3 time zones, while Y recently posted about
      the operational challenges of async communication and building team culture across
      borders.
      - Their careers show a pattern of working in companies between 50-300
      employees—often the stage where processes break and operators are forced to build
      structure. It's likely they both value pragmatic, systems-driven solutions.
      - Y recently celebrated their 5-year company anniversary with a post about "resilience
      over hype," which aligns with X's earlier writing on long-term thinking vs. fundraising
      hype cycles. This shared founder mindset could lead to instant rapport.
      - Each has shown public interest in low-code tooling: Y recently liked several posts about
      Airtable and Notion automations, while X commented on how they've built internal
      systems to reduce reliance on engineering. This operational pragmatism is a shared
      trait.

      Replace X and Y with the actual names of the user of Prospexs and the lead.
      X name: ${linkedin_profile.full_name}
      Y name: ${progress_data.full_name}

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
      IMPORTANT: Return the answers in the following JSON format:
      [
        "similarity 1",
        "similarity 2"
      ]
    `;

    const onlineMentionsPrompt = `
      You are a strategic research analyst within a B2B prospecting engine.
      Your task is to find relevant mentions or signals connected to a specific lead, based on the
      following input:
      - Name: ${progress_data.full_name}
      - Job Title: ${progress_data.job_title}
      - Company: ${progress_data.company_name}

      TIER 1 - Mentions of the Lead (First Priority)
      Search for:
      - Recent quotes, interviews, or media appearances by the lead
      - Mentions of the lead in company press releases, blogs, or events
      - LinkedIn posts where the lead is tagged or publicly commented

      If any mentions are found, summarize:
      - The nature of the mention (e.g. quote, panelist, author)
      - The topic covered
      - Why it may be relevant for outreach or context

      TIER 2 - Mentions of Their Company (Fallback)

      If no lead-specific mentions are available, look for:
      - Company press releases, major announcements, or funding news
      - Mentions in case studies, customer stories, or third-party blogs
      - Comments or reactions to the company's product, hiring, or performance

      Summarize the mention and what it signals about the company's current focus or perception.

      TIER 3 - Mentions of Industry or Competitors (Last Resort)
      If no mentions of the lead or their company are found, provide:
      - A short summary of recent trends, challenges, or opportunities relevant to their industry
      or segment
      - Mentions of 1-2 close competitors or peers (if available)
      - Why these trends or competitor actions might be top-of-mind for the lead
      No relevant mentions were found for the lead or their company.
      Only use information that is explicitly available in the input data. Do not fabricate mentions or
      speculate. Clearly indicate which tier was used: Lead, Company, or Industry. If nothing relevant
      is found at any tier, say so.

      Example Online Mentions:
      - Mention Type: Podcast Interview
      Summary: In a recent podcast episode of SaaS GTM Deep Dives, Sarah Lindqvist (VP
      of Sales at Flowly) discussed how her team shifted from SDR-led to marketing-led
      pipeline generation in Q1 2024. She emphasized attribution challenges, cross-team
      alignment, and her team's focus on increasing average deal size.
      Link: https://example.com/sarah-lindqvist-podcast

      - Mention Type: TechCrunch Article
      Summary: Flowly was featured in a TechCrunch piece announcing its $12M Series A,
      led by Index Ventures. The article quotes the CEO discussing expansion into France and
      doubling the GTM team by the end of the year. No direct quote from Sarah, but as VP
      Sales, she will likely be involved in hiring and sales team growth.
      Link: https://example.com/flowly-seriesa

      - Mention Type: Industry Report
      Summary: A recent Forrester report titled “2024 SaaS Buying Trends in Europe”
      highlights that 64% of mid-market buyers now prefer product-led onboarding with
      minimal sales rep involvement. This trend could directly impact how companies like
      Flowly position their sales motion, especially given their expansion plans.
      Link: https://example.com/2024-saas-buying-trends

      - Mention Type: Panel Discussion
      Summary: Nabil El-Fahkri, Head of Product at Mindbeam, appeared as a speaker on a
      panel titled “AI Ethics in Enterprise Software” during Nordic Tech Week 2024. He spoke
      about balancing speed of deployment with regulatory alignment, especially in B2B SaaS.
      His comments suggest a strong interest in AI governance and responsible innovation.
      Link: https://example.com/nabil-panel-ai-ethics

      - Mention Type: Customer Case Study (Company Blog)
      Summary: Mindbeam recently published a case study highlighting how pharmaceutical
      company Axxira improved workflow compliance by 48% after switching to Mindbeam's
      platform. Although Nabil is not quoted directly, the project falls under his product team,
      suggesting relevance to his current priorities.
      Link: https://example.com/nabil-mindbeam-casestudy

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
      IMPORTANT: Return the answers in the following JSON format:
      [
        {
          "mention_type": "The type of mention",
          "summary": "The summary of the mention",
          "link": "The link to the mention",
        },
        {
          "mention_type": "The type of mention",
          "summary": "The summary of the mention",
          "link": "The link to the mention",
        },
      ]
    `;

    const relevantActivitiesPrompt = `
      You are a senior outbound strategist inside a B2B prospecting platform.
      Your task is to analyze a specific lead's recent LinkedIn activity to surface signals that could be
      useful for sales outreach or meeting prep.

      This is the linkedin url: ${lead_linkedin_url}
      This is the linkedin data: {linkedin_data}

      Focus on surfacing:
      - Posts authored by the lead
      - Comments they've made on relevant topics
      - Content they've liked or reshared
      - Mentions or tags by other people
      - Changes in profile headline or role
      - Event RSVPs, certifications, or feature badges

      The activity should reflect:
      - What the lead is currently thinking about, engaging with, or promoting
      - Topics that align with their strategic focus or personal interests
      - Cues that suggest timing or mindset (e.g., hiring, launching, exploring tools)

      Output Format:
      For each insight you find, include:
      - A summary of the activity (2-3 sentences)
      - The type of interaction (e.g., post, comment, like, reshare, profile update)
      - A link to the post or profile section (if available)
      - The date or time frame (e.g., “2 weeks ago”)
      - Optional: Why this may be relevant to outreach

      Example Relevant LinkedIn Activity:
      - Summary: Posted a job opening for two Enterprise Account Executives in the DACH
      region, emphasizing experience in AI/ML products.
      Type: Authored post
      Link: https://linkedin.com/posts/anne-hartmann_eae-hiring-ai
      When: 6 days ago
      Relevance: Indicates current hiring focus and possible pipeline expansion in Germany
      — good timing for outreach around GTM enablement or recruiting efficiency.

      - Summary: Liked a post from a competitor (DocuMate) announcing their new e-signature
      integration with Microsoft Teams.
      Type: Like
      Link: https://linkedin.com/feed/update/documate-teams
      When: 1 week ago
      Relevance: Suggests interest in adjacent products or keeping tabs on market trends —
      could signal a focus on integrations or product roadmap updates.

      - Summary: Commented “This is the biggest pain point in onboarding right now” on a post
      discussing slow customer implementation cycles in B2B SaaS.
      Type: Comment
      Link: https://linkedin.com/feed/update/slow-onboarding-thread
      When: 2 weeks ago
      Relevance: Signals frustration with onboarding speed — could open the door for
      workflow automation, CS tooling, or faster deployment solutions.

      - Summary: Shared an article from Harvard Business Review titled "Why CFOs Are
      Becoming Product Influencers” with the caption “Seeing this trend firsthand.”
      Type: Reshare
      Link: https://linkedin.com/share/cfo-trend-hbr
      When: 5 days ago
      Relevance: Suggests the lead may be a financially-minded decision-maker with
      influence beyond pure finance — good for positioning ROI-driven tools.

      - Summary: Updated their LinkedIn title from “Growth Advisor” to “VP, Strategic
      Partnerships” at Klara Health.
      Type: Profile Update
      Link: https://linkedin.com/in/sofia-karlsen
      When: 3 weeks ago
      Relevance: Signals a new role and likely open priorities — perfect window to introduce
      new tools or explore co-marketing, integrations, or partnerships.

      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
      IMPORTANT: Return the answers in the following JSON format:
      [
        {
          "summary": "The summary of the activity",
          "type": "The type of interaction",
          "link": "The link to the post or profile section",
          "when": "The date or time frame",
          "relevance": "The relevance of the activity"
        }
      ]
    `;

    const personConversationalStarterPrompt = `
      You are a senior outbound strategist inside a B2B prospecting engine.
      Your task is to generate relevant, natural, and timely conversation starters for ${progress_data.full_name}
      based on all available data.

      This is the linkedin url: ${lead_linkedin_url}
      This is the linkedin data: {linkedin_data}

      Input Context May Include:
      - The lead's LinkedIn activity (posts, likes, profile updates, comments)
      - Any recent mentions of the lead in media, panels, podcasts, or interviews
      - Their company's latest news, funding, hiring, or product launches
      - Industry shifts or competitor activity that might be top-of-mind for someone in their
      role
      - Known challenges, solutions, and impact statements previously identified by
      Prospexs

      Your job is to:
      - Combine 1-2 relevant signals into each friendly, human-level prompt
      - Avoid generic or templated phrasing (“Saw your role, thought I'd reach out”)
      - Focus on curiosity, relevance, and shared interest to spark a reply or discussion
      - Use a tone that is personable, warm, and professionally casual
      Output Format:
      - Generate 3-4 short conversation starters, each 2-3 sentences max.
      - Important: Only use signals that are explicitly present in the input data. Do not assume or
      fabricate insights. If few signals are available, you may fall back on role-specific or industry-level
      cues — but clearly anchor them to the lead's function, not imagined details.

      Example Relevant LinkedIn Activity:
      - Title: Fixing Onboarding Friction
      I saw your post about navigating long onboarding cycles and the impact on revenue
      recognition — feels like something a lot of GTM teams are quietly battling. Curious if
      you've tried anything new to streamline that process, especially now that you're leading
      both sales and CS under one roof.

      - Title: Scaling After Funding
      Congrats on the Series B — with that kind of growth, I imagine aligning product, sales,
      and ops just got a whole lot more interesting. I'd love to hear how you're thinking about
      scaling the GTM motion without letting complexity creep in.

      - Title: AI for Reps: Real or Hype?
      Noticed you commented on a post about AI not replacing reps, but making them sharper
      — couldn't agree more. In your role, are you seeing any tools actually live up to that
      promise, or is it still mostly buzz?

      - Title: Product vs. Sales Mindset
      You and I both seem to follow folks like Kyle Coleman and Lenny Rachitsky — always
      find their takes useful for keeping GTM grounded. Given your background in both
      product and sales, I'm curious how you're balancing top-down strategy with bottom-up
      activation these days.

      - Title: Competitor PLG Moves
      I saw that one of your close competitors just launched in the DACH region with a very
      PLG-heavy push. Wondering if that's affecting how your team's thinking about customer
      acquisition strategy or if you're doubling down on something totally different.

      IMPORTANT!!!!! Directly respond in the JSON format provided below!!!! Do not include any explanatory text or a response sentence, markdown formatting, or additional content outside the JSON structure.
      IMPORTANT: MAKE SURE THE TEXT IS RETURNED IN A LANGUAGE FOLLOWING THIS LANGUAGE CODE: ${language}.
      IMPORTANT: Return the answers in the following JSON format:
      [
        {
          "title": "The title of the conversation starter",
          "content": "The content of the conversation starter",
        },
        {
          "title": "The title of the conversation starter",
          "content": "The content of the conversation starter",
        },
      ]
    `;

    const additionalPrompts = [
      {
        prompt: conversationStarterPrompt,
        fieldName: "conversationStarters",
        category: "businessInsights",
      },
      {
        prompt: commonalitiesPrompt,
        fieldName: "commonalities",
        category: "businessInsights",
      },
      {
        prompt: insightsPrompt,
        fieldName: "insights",
        category: "businessInsights",
      },
      {
        prompt: discoveryPrompt,
        fieldName: "discovery",
        category: "businessInsights",
      },
      {
        prompt: whyNotPrompt,
        fieldName: "whyNow",
        category: "businessInsights",
      },
      {
        prompt: awardsPrompt,
        fieldName: "awards",
        category: "personInsights",
        getLinkedinData: true,
      },
      {
        prompt: interestsPrompt,
        fieldName: "interests",
        category: "personInsights",
        getLinkedinData: true,
      },
      {
        prompt: educationPrompt,
        fieldName: "education",
        category: "personInsights",
        getLinkedinData: true,
      },
      {
        prompt: relevantInsightsPrompt,
        fieldName: "relevantInsights",
        category: "personInsights",
        getLinkedinData: true,
      },
      {
        prompt: similaritiesPrompt,
        fieldName: "similarities",
        category: "personInsights",
        getLinkedinData: true,
        useChatCompletion: true,
      },
      {
        prompt: onlineMentionsPrompt,
        fieldName: "onlineMentions",
        category: "personInsights",
        getLinkedinData: true,
      },
      {
        prompt: relevantActivitiesPrompt,
        fieldName: "relevantActivities",
        category: "personInsights",
        getLinkedinData: true,
      },
      {
        prompt: personConversationalStarterPrompt,
        fieldName: "personConversationalStarters",
        category: "personInsights",
        getLinkedinData: true,
      },
    ];

    const promises = additionalPrompts.map(
      async (
        {
          prompt,
          fieldName,
          category,
          getLinkedinData,
          useChatCompletion = false,
        },
        index
      ) => {
        try {
          console.log(`===== Step ${index + 1}: Getting ${fieldName} =====`);

          if (getLinkedinData) {
            const proxycurlApiKey = Deno.env.get("Proxycurl_API");
            const url = new URL("https://enrichlayer.com/api/v2/profile");

            url.searchParams.set("url", lead_linkedin_url);
            url.searchParams.set("use_cache", "if-present");

            console.log("Making request to:", url.toString());

            const response = await fetch(url.toString(), {
              method: "GET",
              headers: {
                Authorization: `Bearer ${proxycurlApiKey}`,
              },
            });

            const linkedinData = await response.json();
            prompt = prompt.replace(
              "{linkedin_data}",
              JSON.stringify(linkedinData)
            );
          }

          let response;
          if (useChatCompletion) {
            const completion = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [{ role: "user", content: prompt }],
              temperature: 0.7,
              max_tokens: 1500,
            });
            response = completion.choices[0].message.content;
          } else {
            response = await openai.responses.create({
              model: "gpt-4.1",
              tools: [{ type: "web_search_preview" }],
              input: prompt,
            });

            response = response.output_text;
            console.log(`Response for ${fieldName}:`, response);
          }

          const cleanResponse = cleanJsonResponse(response);

          let parsedResponse;
          try {
            parsedResponse = JSON.parse(cleanResponse);
          } catch (error) {
            console.error(`Failed to parse ${fieldName} output:`, error);
            throw new Error(`Failed to parse AI response for ${fieldName}`);
          }

          updatedLead.insights[category][fieldName] = parsedResponse;

          return parsedResponse;
        } catch (error) {
          updatedLead.insights[category][fieldName] = [];
          console.error(
            `Error for job ${jobData.id} getting ${fieldName}:`,
            error
          );
        }
      }
    );

    await Promise.all(promises);

    const generectApiKey = "9923f958608bb3dd9e446506c6213706b46de708";
    const generectUrl = "https://api.generect.com/api/linkedin/email_finder/";
    const generectHeaders = {
      "Content-Type": "application/json",
      Authorization: `Token ${generectApiKey}`,
    };

    const generectBody = [
      {
        first_name: progress_data.first_name,
        last_name: progress_data.last_name,
        domain: cleanDomain(progress_data.company_website),
      },
    ];
    const generectResponse = await fetch(generectUrl, {
      method: "POST",
      headers: generectHeaders,
      body: JSON.stringify(generectBody),
    });

    const generectData = await generectResponse.json();
    const email = generectData[0]?.valid_email;
    updatedLead.email = email;

    console.log(`Saving new lead to progress database:`, updatedLead.full_name);
    console.log(`Campaign progress id:`, campaignData.progress_id);

    const { error } = await supabase.rpc("append_step_10_result", {
      p_campaign_progress_id: campaignData.progress_id,
      p_job_result: updatedLead,
      p_latest_step: 10,
    });

    if (error) {
      console.error(`RPC Error ${jobData.id}:`, error);
    }

    const { error: updateJobError } = await supabase
      .from("jobs")
      .update({ status: "completed" })
      .eq("id", jobData.id);

    if (updateJobError) {
      console.error(`Error updating job ${jobData.id}:`, updateJobError);
      return new Response(JSON.stringify({ error: updateJobError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(
      JSON.stringify({
        message: "Success",
        data: updatedLead,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error(`Error for job ${jobData.id}:`, error);
    await supabase
      .from("jobs")
      .update({ status: "queued" })
      .eq("id", jobData.id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/lead-insights-5' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
