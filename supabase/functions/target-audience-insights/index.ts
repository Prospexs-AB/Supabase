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

    const categories = [
      {
        name: "usps",
        label: "Unique Selling Points",
        data: unique_selling_points,
        promptExample: `
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
          teams to protect throughput and profitability even under volatile labor conditions.`,
      },
      {
        name: "benefits",
        label: "Benefits",
        data: benefits,
        promptExample: `
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
        of the most volatile elements of manufacturing operations: the hourly workforce.`,
      },
      {
        name: "problems",
        label: "Problems Solved",
        data: problem_solved,
        promptExample: `
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
        performance.`,
      },
    ];

    const listOfInsights = [];
    const recommendationsPromises = recommendations.map(
      async (recommendation) => {
        const { role, industry, reasoning, country } = recommendation;
        let finalInsights = {
          role,
          industry,
          reasoning,
          country,
          insights: {},
        };

        // for (const category of categories) {
        //   const { name, data, label, promptExample } = category;
        //   const prompt = `
        //     You are a senior industry analyst. Write 5 consulting-grade paragraphs analyzing how ${companyWebsite}'s ${label} directly affect ${role} at ${industry} in ${country}.

        //     Language: ${language}

        //     Requirements per paragraph:
        //     - 150 words max
        //     - 3+ quantifiable data points
        //     - Compare against alternatives
        //     - Focus on daily workflow impact
        //     - Use verifiable sources

        //     Base analysis on:
        //     ${data.map((singleData) => `- ${singleData.value}`).join("\n")}

        //     IMPORTANT: MUST prioritize public sources (news, industry reports, credible outlets) over company websites.
        //     Try to not use the same source for multiple points.
        //     If there are no public sources, then use the company website, THERE MUST BE A SOURCE.
        //     IMPORTANT: Return only JSON. No links or citations in descriptions - put URLs in source array.
        //     Important: Return ONLY raw JSON. Do not use triple backticks, markdown, or extra explanations.
        //     Format:
        //     [
        //       {
        //         "title": "Title",
        //         "description": "Description (no URLs)",
        //         "source": ["source url here", "source url here"]
        //       }
        //     ]
        //   `;

        const context = `
          USPs: ${unique_selling_points
            .map(
              (usp, index) => `
                ${index + 1}. Title: ${usp.value}
                Description: ${usp.description}
                Source: ${usp.source}
            `
            )
            .join("\n")}
          Benefits: ${benefits
            .map(
              (benefit, index) => `
                ${index + 1}. Title: ${benefit.value}
                Description: ${benefit.description}
                Source: ${benefit.source}
            `
            )
            .join("\n")}
          Problems Solved: ${problem_solved
            .map(
              (problem, index) => `
                ${index + 1}. Title: ${problem.value}
                Description: ${problem.description}
                Source: ${problem.source}
            `
            )
            .join("\n")}
        `;

        console.log("Context:", context);

        const prompt = `
          You are a senior industry analyst at a top global consultancy.
          Your task: Produce a detailed Audience Insights brief for a given target audience (Role: ${role}, Industry: ${industry}, Country: ${country}).
          This should combine deep research with previously extracted USPs, Benefits, and Problems Solved for ${companyName}.
          Ensure that the language is ${language}.

          ${context}

          1. Audience Profile
          ● Write a 200-250 word analyst-level profile of this audience (e.g., “HR Directors at
          large tech companies in Romania”).
          ● Include:
            ○ Role-specific responsibilities and KPIs (e.g., cost control, compliance, digital
            transformation).
            ○ Industry-specific challenges (e.g., Romanian e-commerce managers facing
            workforce shortages).
            ○ Local context (laws, market trends, labor data, regulatory environment).
          ● Use at least 3-5 public sources (market reports, news, industry data) and cite them
          inline (e.g., “According to PwC's 2024 Global Workforce Report...”).

          2. Audience Sources
          ● Provide 5 clickable sources directly under the Audience Profile.
          ● These should be the reports, articles, or datasets used to inform the Audience
          Profile (e.g., Eurostat labor market data, Gartner surveys, country-specific HR reports).

          3. Key Data Points
          ● Summarize 4-6 high-impact insights for this audience (bullet points).
          ● These should be the most actionable findings from the Audience Profile and the
          audience-specific USPs, Benefits, and Problems Solved.
          ● Each data point must have a short descriptive title (e.g., “Rising Workforce
          Compliance Costs in Romania”) and link to its source.

          4. USPs, Pain Points, Benefits (Audience-Specific)
          ● Write 3-4 USPs, 3-4 Pain Points, and 3-4 Benefits tailored to this audience.
          ● Each section should be 150-200 words per item, sourced, and contextualized for the
          role/industry/country.
          ● Use multiple public, verifiable sources (press releases, reports, analyst insights).

          Output Format:
          Audience Profile: [200-250 word analysis + inline citations]
          Sources: [5 clickable URLs with source names]
          Key Data Points:
          ● [Title + 1-2 sentence summary + source]
          ● [Repeat 4-6 times]

          USPs:
          1. [Title + 150-200 word analysis + sources]
          2. ...

          Pain Points:
          1. ...

          Benefits:
          1. ...

          Examples for www.jobandtalent.com (PwC providing the solution)

          Audience Profile
          Operations Managers in Spain's logistics sector are under mounting pressure to reduce costs,
          maintain service-level agreements, and navigate strict labor compliance requirements.
          The sector employs over 1 million workers (Spanish Ministry of Transport, 2024) and faces
          turnover rates of 25-30% among warehouse staff (Eurofound Labor Market Report, 2024).
          Compliance with Spanish labor laws, such as Registro de Jornada (daily working-time
          tracking) and sectoral collective bargaining agreements, significantly increases administrative
          burden. Non-compliance can lead to fines of up to €187,000 per infraction (Spanish Labor
          Inspectorate, 2024).
          Additionally, Spain's e-commerce boom—growing at 15% YoY (CNMC E-Commerce Report,
          2024)—has increased demand volatility, forcing operations managers to balance workforce
          flexibility with delivery performance. According to PwC's Global Operations Pulse Survey
          (2024), 63% of logistics leaders in Southern Europe cite “scaling operations quickly without
          inflating labor costs” as a top priority. These challenges make workforce platforms like
          Job&Talent appealing. However, as operations scale across multiple regions and enterprise
          clients, integrating PwC's global workforce management solutions offers added value:
          harmonized compliance, streamlined reporting, and AI-driven workforce
          analytics—freeing managers from repetitive admin tasks and allowing them to focus on
          throughput, cost efficiency, and client SLAs.
          Sources
          1. Spanish Ministry of Transport - Logistics Sector Labor Statistics (2024) -
          https://mitma.gob.es
          2. Eurofound Labor Market Report - Southern Europe Logistics Workforce (2024) -
          https://eurofound.europa.eu
          3. Spanish Labor Inspectorate - Registro de Jornada Compliance Fines (2024) -
          https://mites.gob.es
          4. CNMC E-Commerce Growth Report - Spain 2024 - https://cnmc.es
          5. PwC Global Operations Pulse Survey (2024) - https://pwc.com

          Key Data Points

          ● Rising Turnover in Spanish Logistics: Warehouse staff turnover averages 25-30%,
          disrupting continuity and inflating recruitment costs. (Eurofound, 2024)
          ● Compliance Costs are Increasing: Fines for non-compliance with Registro de
          Jornada can reach €187,000 per case. (Spanish Labor Inspectorate, 2024)
          ● E-Commerce Drives Volatility: Spain's logistics sector is growing 15% YoY, increasing
          workforce planning complexity. (CNMC, 2024)
          ● Scaling Without Cost Inflation: 63% of logistics leaders in Southern Europe cite
          efficient scaling as their top challenge. (PwC Global Ops Survey, 2024)

          Example:

          USPs
          PwC-Enhanced Compliance and Reporting
          Managing compliance in Spain's logistics sector is complex, with requirements like Registro de
          Jornada (daily working-time logging), collective bargaining agreements, and sector-specific
          reporting. Non-compliance fines can reach €187,000 per infraction (Spanish Labor
          Inspectorate, 2024). Job&Talent's existing compliance tools address core tracking needs, but
          PwC extends this with end-to-end compliance management, including automated geo-tagged
          attendance, consolidated reporting across multi-site operations, and audit-ready payroll
          documentation. These features reduce administrative burden by up to 25-30% (PwC
          Compliance Impact Study, 2024), freeing operations managers to focus on meeting client SLAs
          and throughput targets. Moreover, PwC's country-specific advisory teams help navigate evolving
          labor regulations, reducing the risk of penalties during labor inspections. This positions
          Job&Talent as a trusted partner for enterprise clients who require bulletproof compliance in
          high-risk sectors like last-mile delivery and e-commerce logistics.
          Sources: Spanish Labor Inspectorate 2024, PwC Compliance Impact Study 2024, Eurofound
          Labor Market Report 2024.
          
          AI-Driven Workforce Demand Forecasting
          Seasonal demand surges driven by Spain's 15% YoY e-commerce growth (CNMC, 2024)
          place heavy strain on logistics managers. Traditional staffing models often lead to under- or
          over-hiring, inflating labor costs and increasing SLA penalties. PwC's Workforce Insights
          Platform integrates predictive analytics into Job&Talent's ecosystem, improving scheduling
          accuracy by up to 20% (PwC Workforce Benchmark, 2024). By analyzing historical data, order
          volumes, and regional labor availability, the system recommends optimal staffing levels for
          warehouses and last-mile operations. This results in 15-20% fewer overtime hours and
          reduced reliance on last-minute staffing agencies. For managers, this means fewer costly
          disruptions during peak seasons (e.g., Black Friday, holiday campaigns) and higher on-time
          delivery rates. The outcome is not just cost efficiency but also a competitive advantage in
          maintaining service quality under fluctuating demand.
          Sources: CNMC 2024, PwC Workforce Benchmark 2024, PwC Logistics Case Studies 2023.

          Pain Points
          Administrative Overload in Compliance
          Operations managers in Spanish logistics spend up to 35% of their time on compliance
          administration—logging hours, preparing audit files, and managing payroll data (Eurofound,
          2024). With labor inspections becoming more frequent and penalties for errors reaching
          €187,000, the stakes are high (Spanish Labor Inspectorate, 2024). This reactive, manual
          approach diverts time from core performance metrics like throughput and SLA adherence.
          PwC's integrated compliance solution automates these processes, providing audit-ready
          records and real-time dashboards, significantly reducing the risk of human error. By alleviating
          this burden, managers can reallocate resources toward optimizing operations, driving
          efficiencies, and improving client delivery metrics.
          Sources: Eurofound 2024, Spanish Labor Inspectorate 2024, PwC Compliance Impact Study
          2024.

          High Turnover and Training Costs
          With 25-30% annual turnover among warehouse staff (Eurofound, 2024), Spanish logistics
          managers face recurring recruitment and training cycles that cost €3,000-€5,000 per
          replacement (PwC Workforce Cost Analysis, 2023). This disrupts team cohesion and
          jeopardizes delivery timelines, particularly during high-volume periods. Job&Talent's
          engagement features improve retention, while PwC's data-driven workforce analytics enhance it
          further by aligning worker incentives with performance. For managers, this means reduced
          churn, lower training costs, and a more stable workforce—crucial for maintaining operational
          consistency in time-sensitive delivery networks.
          Sources: Eurofound 2024, PwC Workforce Cost Analysis 2023.

          Benefits
          Reduced Compliance Risk and Cost
          PwC's compliance solutions reduce the likelihood of non-compliance fines by over 60%
          through automated tracking, standardized reporting, and advisory oversight (PwC Compliance
          Impact Study, 2024). This allows managers to confidently meet legal obligations while
          reallocating time and resources to operational KPIs like delivery performance and cost
          efficiency.
          Sources: PwC Compliance Impact Study 2024, Spanish Labor Inspectorate 2024.

          Faster, Smarter Workforce Scaling
          AI-powered labor forecasting improves scheduling efficiency by up to 20%, cutting overtime
          costs by 15-20% and ensuring adequate coverage for peak periods (PwC Workforce
          Benchmark 2024). This allows managers to meet demand without overstaffing—protecting
          margins while maintaining service levels.
          Sources: PwC Workforce Benchmark 2024, CNMC 2024.

          Important: Return ONLY raw JSON. Do not use triple backticks, markdown, or extra explanations.
          Ensure that the keynames in the JSON object are all lowercase and spaces are replaced with underscores.
          Ensure that every usp, pain point, and benefit will have a title, analysis and a source array for one or more sources.
          IMPORTANT: Return ONLY raw JSON. Do not use triple backticks, markdown, or extra explanations.
          IMPORTANT: Ensure the json follows the format:
          {
            "industry": "Industry of the audience",
            "industry_english": "English name of the industry",
            "role": "Role of the audience",
            "role_english": "English name of the role",
            "reasoning": "Reasoning for the audience",
            "metrics": [ { "value": "Value of the metric","label": "Label of the metric" } ],
            "country": "Country of the audience",
            "country_english": "English name of the country",
            "audience_profile": "Profile of the audience",
            "sources": ["source1", "source2"],
            "key_data_points": [ { "title": "Key Data Point 1", "summary": "Summary of the key data point", "source": "source1" } ],
            "usps": [ { "title": "Usp 1", "analysis": "Analysis of the usp", "source": ["source1", "source2"] ] } ],
            "pain_points": [ { "title": "Pain Point 1", "analysis": "Analysis of the pain point", "source": ["source1", "source2"] } ],
            "benefits": [ { "title": "Benefit 1", "analysis": "Analysis of the benefit", "source": ["source1", "source2"] } ]
          }
        `;

        console.log("Prompt:", prompt);

        console.log("Sending request to OpenAI API...");
        const openAiResponse = await openai.responses.create({
          model: "gpt-4.1",
          tools: [{ type: "web_search_preview" }],
          input: prompt,
          max_output_tokens: 6000,
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

        const parsedAnalysis = JSON.parse(cleanAnalysis);
        console.log("Parsed analysis:", parsedAnalysis);
        // finalInsights.insights[name] = parsedAnalysis;
        // }

        listOfInsights.push({ ...recommendation, ...parsedAnalysis });
      }
    );

    await Promise.all(recommendationsPromises);

    const new_latest_step = 7;
    const cleanFurtherProgress = {};
    for (let x = new_latest_step + 1; x <= 10; x++) {
      const keyName = `step_${x}_result`;
      cleanFurtherProgress[keyName] = null;
    }

    const { error: updateError } = await supabase
      .from("campaign_progress")
      .update({
        latest_step: new_latest_step,
        step_7_result: listOfInsights,
        ...cleanFurtherProgress,
      })
      .eq("id", campaignData.progress_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(
      JSON.stringify({
        message: "Successfully created target audience insights",
        data: listOfInsights,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
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
