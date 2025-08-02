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

// Deno.serve(async (req) => {
//   // Handle CORS preflight requests
//   if (req.method === "OPTIONS") {
//     return new Response(null, {
//       status: 200,
//       headers: corsHeaders,
//     });
//   }

//   try {
//     const supabase = createClient(
//       "https://lkkwcjhlkxqttcqrcfpm.supabase.co",
//       "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxra3djamhsa3hxdHRjcXJjZnBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTMxMzE5OCwiZXhwIjoyMDYwODg5MTk4fQ.e8SijEhKnoa1R8dYzPBeKcgsEjKtXb9_Gd1uYg6AhuA"
//     );

//     const userId = await getUserId(req, supabase);
//     const { campaign_id, lead } = await req.json();

//     const { data: campaignData, error: campaignError } = await supabase
//       .from("campaigns")
//       .select("*")
//       .eq("id", campaign_id)
//       .eq("user_id", userId)
//       .single();

//     if (campaignError) {
//       return new Response(JSON.stringify({ error: campaignError.message }), {
//         headers: { ...corsHeaders, "Content-Type": "application/json" },
//         status: 500,
//       });
//     }

//     const { data: progressData, error: progressError } = await supabase
//       .from("campaign_progress")
//       .select("*")
//       .eq("id", campaignData.progress_id)
//       .single();

//     if (progressError) {
//       return new Response(JSON.stringify({ error: progressError.message }), {
//         headers: { ...corsHeaders, "Content-Type": "application/json" },
//         status: 500,
//       });
//     }

//     // type ToneOption =
//     //   | "Humorous"
//     //   | "Diplomatic"
//     //   | "Formal"
//     //   | "Casual"
//     //   | "Excited";
//     // type LengthOption =
//     //   | "Short & Concise"
//     //   | "Long & Informative"
//     //   | "Medium Length";
//     // type EmailTypeOption =
//     //   | "Book a meeting"
//     //   | "Follow up"
//     //   | "Introduction"
//     //   | "Proposal"
//     //   | "Thank you";

//     return new Response(JSON.stringify({}), {
//       headers: { ...corsHeaders, "Content-Type": "application/json" },
//     });
//   } catch (error) {
//     return new Response(JSON.stringify({ error: error.message }), {
//       headers: { ...corsHeaders, "Content-Type": "application/json" },
//       status: 500,
//     });
//   }
// });

// Initialize Supabase client
const supabase = createClient(
  "https://lkkwcjhlkxqttcqrcfpm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxra3djamhsa3hxdHRjcXJjZnBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTMxMzE5OCwiZXhwIjoyMDYwODg5MTk4fQ.e8SijEhKnoa1R8dYzPBeKcgsEjKtXb9_Gd1uYg6AhuA"
);

// OpenAI API key
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

async function generateEmailComponent(prompt) {
  try {
    const openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
    });

    console.log("prompt", prompt);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert email copywriter specializing in personalized business outreach and cold emails. Your expertise includes:

          - Creating highly personalized, engaging email content that feels authentic and human
          - Adapting tone and style based on the recipient's role, industry, and company context
          - Using specific details and insights to create meaningful connections
          - Writing compelling subject lines and email body content
          - Balancing professionalism with approachability
          - Ensuring emails are concise, clear, and action-oriented
          
          Key principles:
          - Always use the recipient's name and company context when available
          - Reference specific details from their background, achievements, or company news
          - Maintain the requested tone (formal, casual, diplomatic, excited, or humorous)
          - Keep content within the specified word count
          - Focus on value proposition and mutual benefit
          - End with clear, non-pushy calls to action

          IMPORTANT: Use actual names provided in the context for sender and receiver.
          
          Write in a way that feels like a genuine human reaching out, not an automated message.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    });

    return completion.choices[0].message.content.trim();
  } catch (error) {
    return `Error generating content: ${error.message}`;
  }
}

async function generateEmail1(
  senderDetails,
  receiverDetails,
  tone = "Casual",
  length = "Medium Length"
) {
  // Prepare context
  const senderName = senderDetails.person?.name || "";
  const receiverName = receiverDetails.person?.name || "";
  const senderCompany = senderDetails.company?.name || "";
  const receiverCompany = receiverDetails.company?.name || "";

  const context = {
    senderContext: senderDetails.person?.facts || "",
    receiverContext: receiverDetails.person?.facts || "",
    senderName,
    receiverName,
    senderCompanyDetails: senderDetails.company?.details || "",
    receiverCompanyDetails: receiverDetails.company?.details || "",
    receiverCompanyFacts: receiverDetails.company?.facts_and_figures || "",
    senderAvailability: senderDetails.availability || "",
    currentDay: new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    story: `Sender: ${senderName} from ${senderCompany} reaching out to ${receiverName} at ${receiverCompany}`,
  };

  // Determine word count based on length
  const getWordCount = (length) => {
    switch (length) {
      case "Short & Concise":
        return "50-100";
      case "Long & Informative":
        return "200-300";
      case "Medium Length":
      default:
        return "100-200";
    }
  };

  const wordCount = getWordCount(length);

  // Generate Subject
  const subjectPrompt = `
    Extract 3 unique keywords (nouns) from this story that are specific to the sender or receiver, not common or generic—focus on proper nouns (e.g., brands, products, events, locations), 1-3 words long, each representing something different.
    
    Instructions:
    - Focus on names that stand out. Keep it intriguing.
    - Skip generic terms like 'Acquisition' or 'Q1 2024 target'.
    - Keep it short and mysterious—don't add extra descriptions.
    - Avoid generic words like 'AI' or 'UX'.
    - Don't mention the sender or receiver's names.
    
    Context: ${context.story}
    
    Output format: Keywords: Keyword1 + Keyword2 + Keyword3
  `;
  const subject = await generateEmailComponent(subjectPrompt);

  // Generate HPEF
  const hpefPrompt = `
    Craft a personalized email introduction (HPEF) for the sender to share with the receiver, using relevant context about the receiver. The message should feel ${tone.toLowerCase()}, highly personalized, and flow naturally.
    
    Rules:
    - Make the HPEF ${tone.toUpperCase()}, conversational and highly personalized
    - Use an ANCHOR FROM THE CONTEXT to start the HPEF, mentioning the source
    - Keep the lines CONCISE and easy to read/understand
    - The HPEF should be a SINGLE paragraph with about ${wordCount} words and 2-4 sentences
    - There should at least be two proper nouns in every sentence
    - Never put the receiver's first name in the first sentence
    
    Tone Guidelines:
    ${
      tone === "Humorous"
        ? "- Include light humor, witty observations, or playful language"
        : ""
    }
    ${
      tone === "Diplomatic"
        ? "- Use measured, respectful language with careful word choice"
        : ""
    }
    ${
      tone === "Formal"
        ? "- Maintain professional, business-appropriate language"
        : ""
    }
    ${
      tone === "Casual" ? "- Keep it relaxed, friendly, and conversational" : ""
    }
    ${
      tone === "Excited"
        ? "- Use enthusiastic, energetic language with positive energy"
        : ""
    }
    
    Anchor Checklist (use 1-2 in this order):
    1. Recent Activity of the Receiver
    2. Personal Interests or Hobbies
    3. Company-Specific Data
    4. Industry-Happening
    5. Personal Happenings
    6. Mutual Connections or Referrals
    7. Education or Skills
    
    Prohibited Phrases (avoid these):
    - I recently came across, I admire your, Curious to hear more about your
    - Looking forward to, It's clear you have a strong focus on, It's truly impressive
    - I found your insights on, Inspiring, Amazing, Incredible, Impressive
    
    Context:
    Sender: ${context.senderContext}
    Receiver: ${context.receiverContext}
    Company Facts: ${context.receiverCompanyFacts}

    IMPORTANT: Use actual names provided in the context for sender and receiver.
    
    Write a ${wordCount} word HPEF paragraph with 2-4 sentences in a ${tone.toLowerCase()} tone.
  `;
  const hpef = await generateEmailComponent(hpefPrompt);

  // Generate Value Proposition
  const openingPhrases = [
    `This is where I see ${senderCompany} really stepping in.`,
    `That's where ${senderCompany} could really shine.`,
    `I believe ${senderCompany} can be a game-changer here.`,
    `This is exactly where ${senderCompany} can help.`,
    `I think ${senderCompany} could really move the needle here.`,
    `This is where ${senderCompany} could make all the difference.`,
    `This is where I think ${senderCompany} could really step up for you!`,
  ];
  const openingPhrase =
    openingPhrases[Math.floor(Math.random() * openingPhrases.length)];

  const vpPrompt = `
    Write a Value Proposition paragraph where the Sender clearly outlines the unique value their company offers to the Receiver. The paragraph should include relevant facts and figures, maintaining a ${tone.toLowerCase()}, breezy tone.
    
    Structure:
    - Start with the Company's Core Strength
    - Establish Credibility
    - Showcase Recent Achievements or Milestones
    - Detail the Practical Benefits
    - Expand on Key Capabilities
    - Conclude with Advanced Features or Future Potential
    
    Rules:
    - The tone should feel ${tone.toLowerCase()} and ${
    tone === "Casual"
      ? "relaxed"
      : tone === "Formal"
      ? "professional"
      : tone === "Excited"
      ? "energetic"
      : tone === "Humorous"
      ? "witty"
      : "measured"
  }, not like a formal sales pitch
    - Avoid overly formal or technical language
    - Focus on clarity and flow
    - Choose modern, commonly used words and phrases
    
    Start with this opening phrase: ${openingPhrase}
    
    Context:
    Sender Company: ${context.senderCompanyDetails}
    Best Challenge/Solution: ${senderDetails.company?.facts_and_figures || ""}

    IMPORTANT: Use actual names provided in the context for sender and receiver.
    
    Write a ${wordCount} word value proposition paragraph in a ${tone.toLowerCase()} tone.
  `;
  const vp = await generateEmailComponent(vpPrompt);

  // Generate Transition to Business
  const ttbPrompt = `
    Smoothly transition from a personal touch to addressing a specific business challenge the recipient might be facing.
    
    Structure:
    - Casual Opener: Start with a relatable comment about recent activities, news, or trends
    - Introduce the Challenge: Highlight a concrete challenge backed by facts and figures
    - Build Empathy: Acknowledge the difficulty or effort required
    - Lay-Up for a Solution: Prepare the recipient for a solution without presenting it
    
    Rules:
    - Keep the tone ${tone.toLowerCase()}, friendly, and highly personalized
    - Be specific to the recipient and their company
    - Ensure the paragraph is concise (${wordCount} words) with 2-4 sentences
    - Use the provided facts and figures to support the TTB
    - Do not make assumptions or hypothesize about challenges
    
    Prohibited Phrases:
    - Streamlining these processes, Operational efficiency, I recently came across
    - I admire your, Curious to hear more about your, Deeply excited to
    - Looking forward to, As someone who, Navigating the challenges
    - Product efficiency, Exhilarating, Resonated with me
    
    Context:
    Receiver Company Facts: ${context.receiverCompanyFacts}
    HPEF: ${hpef}

    IMPORTANT: Use actual names provided in the context for sender and receiver.
    
    Write a ${wordCount} word TTB paragraph with 2-4 sentences in a ${tone.toLowerCase()} tone.
  `;
  const ttb = await generateEmailComponent(ttbPrompt);

  // Generate Objection Handling
  const objectionPrompt = `
    Address potential objections or concerns the recipient might have about the proposed solution or meeting.
    
    Structure:
    - Acknowledge the Objection: Show understanding of potential concerns
    - Provide Reassurance: Offer credible solutions or alternatives
    - Maintain Confidence: Keep the tone positive and solution-focused
    - Bridge to Next Step: Smoothly transition to the call to action
    
    Rules:
    - Use a ${tone.toLowerCase()} tone throughout
    - Address common objections like time constraints, budget concerns, or decision-making processes
    - Keep it concise (${wordCount} words) and focused
    - Don't be defensive or pushy
    
    Context:
    Sender Company: ${context.senderCompanyDetails}
    Receiver Company: ${context.receiverCompanyDetails}

    IMPORTANT: Use actual names provided in the context for sender and receiver.
    
    Write a ${wordCount} word objection handling paragraph in a ${tone.toLowerCase()} tone.
  `;
  const objection = await generateEmailComponent(objectionPrompt);

  // Generate Call to Action
  const ctaPrompt = `
    Create a clear, compelling call to action that encourages the recipient to take the next step.
    
    Structure:
    - Clear Action: Specify what you want the recipient to do
    - Value Proposition: Remind them of the benefit
    - Flexibility: Show willingness to accommodate their schedule
    - Urgency: Create gentle urgency without being pushy
    
    Rules:
    - Use a ${tone.toLowerCase()} tone
    - Be specific about the next step (meeting, call, etc.)
    - Include the sender's availability information
    - Keep it concise (${wordCount} words)
    - Make it easy for them to respond
    
    Context:
    Sender Availability: ${context.senderAvailability}
    Current Date: ${context.currentDay}

    IMPORTANT: Use actual names provided in the context for sender and receiver.
    
    Write a ${wordCount} word call to action paragraph in a ${tone.toLowerCase()} tone.
  `;
  const cta = await generateEmailComponent(ctaPrompt);

  return {
    subject,
    body: {
      hpef,
      value_proposition: vp,
      transition_to_business: ttb,
      objection_handling: objection,
      call_to_action: cta,
    },
    full_email: `${hpef}\n\n${vp}\n\n${ttb}\n\n${objection}\n\n${cta}`,
  };
}

async function generateEmail2(
  senderDetails,
  receiverDetails,
  previousEmails = "",
  tone = "Casual",
  length = "Medium Length"
) {
  // Determine word count based on length
  const getWordCount = (length) => {
    switch (length) {
      case "Short & Concise":
        return "25-35";
      case "Long & Informative":
        return "45-60";
      case "Medium Length":
      default:
        return "35-45";
    }
  };

  const wordCount = getWordCount(length);

  // Generate Subject
  const subjectPrompt = `
    Create a brief, engaging subject line for a follow-up email.
    
    Rules:
    - Keep it short (3-6 words)
    - Reference the previous email or conversation
    - Make it intriguing but not pushy
    - Use a ${tone.toLowerCase()} tone
    
    Context:
    Previous Email: ${previousEmails}
    Sender: ${senderDetails.person?.name || ""}
    Receiver: ${receiverDetails.person?.name || ""}
    
    Write a brief subject line in a ${tone.toLowerCase()} tone.
  `;
  const subject = await generateEmailComponent(subjectPrompt);

  // Generate Body
  const bodyPrompt = `
    Write a brief follow-up email that refers back to the initial message without adding any new information.
    
    Rules:
    - Do not introduce new information or suggestions
    - Keep the email brief, ideally within ${wordCount} words
    - Include a reference to the initial email
    - Maintain a ${tone.toLowerCase()} tone and friendly, non-pushy demeanor
    - Use simple language that's easy to understand
    
    Tone Guidelines:
    ${tone === "Humorous" ? "- Include light humor or playful language" : ""}
    ${tone === "Diplomatic" ? "- Use measured, respectful language" : ""}
    ${
      tone === "Formal"
        ? "- Maintain professional, business-appropriate language"
        : ""
    }
    ${
      tone === "Casual" ? "- Keep it relaxed, friendly, and conversational" : ""
    }
    ${tone === "Excited" ? "- Use enthusiastic, energetic language" : ""}
    
    Context:
    Previous Email: ${previousEmails}
    Sender: ${senderDetails.person?.name || ""}
    Receiver: ${receiverDetails.person?.name || ""}

    IMPORTANT: Use actual names provided in the context for sender and receiver.
    
    Write a ${wordCount} word follow-up email in a ${tone.toLowerCase()} tone.
  `;

  const body = await generateEmailComponent(bodyPrompt);
  return { subject, body };
}

async function generateEmail3(
  senderDetails,
  receiverDetails,
  previousEmails = "",
  tone = "Casual",
  length = "Medium Length"
) {
  const paragraphs = {};

  // Determine word count based on length
  const getWordCount = (length) => {
    switch (length) {
      case "Short & Concise":
        return "60-80";
      case "Long & Informative":
        return "120-150";
      case "Medium Length":
      default:
        return "80-120";
    }
  };

  const wordCount = getWordCount(length);

  // Generate Subject
  const subjectPrompt = `
    Create a compelling subject line for a follow-up email that brings fresh perspective.
    
    Rules:
    - Keep it short (4-7 words)
    - Hint at new insights or fresh perspective
    - Make it intriguing but professional
    - Use a ${tone.toLowerCase()} tone
    - Don't be too salesy or pushy
    
    Context:
    Previous Emails: ${previousEmails}
    Sender: ${senderDetails.person?.name || ""}
    Receiver: ${receiverDetails.person?.name || ""}

    IMPORTANT: Use actual names provided in the context for sender and receiver.
    
    Write a compelling subject line in a ${tone.toLowerCase()} tone.
  `;
  const subject = await generateEmailComponent(subjectPrompt);

  // Paragraph 1
  const p1Prompt = `
    Write a FollowUP Email with 3 paragraphs that bring fresh perspective and new facts/figures.
    
    Paragraph 1 - Reiterate the same challenge from the previous email, offering a new perspective
    
    Rules:
    - Avoid repeating facts and figures used in the first email
    - Bring a fresh angle, story, or observation
    - Ensure it feels engaging and relatable without sounding repetitive
    - Keep it ${wordCount} words
    
    Tone: ${tone.toLowerCase()}, friendly, and conversational
    
    Tone Guidelines:
    ${tone === "Humorous" ? "- Include light humor or witty observations" : ""}
    ${tone === "Diplomatic" ? "- Use measured, respectful language" : ""}
    ${
      tone === "Formal"
        ? "- Maintain professional, business-appropriate language"
        : ""
    }
    ${
      tone === "Casual" ? "- Keep it relaxed, friendly, and conversational" : ""
    }
    ${tone === "Excited" ? "- Use enthusiastic, energetic language" : ""}
    
    Context:
    Previous Emails: ${previousEmails}
    Available Facts: ${senderDetails.company?.facts_and_figures || ""}

    IMPORTANT: Use actual names provided in the context for sender and receiver.
    
    Write paragraph 1 (${wordCount} words) in a ${tone.toLowerCase()} tone.
  `;
  paragraphs.paragraph_1 = await generateEmailComponent(p1Prompt);

  // Paragraph 2
  const p2Prompt = `
    Paragraph 2 - Link the solution to the challenge described in the first paragraph
    
    Rules:
    - Use different facts and figures from the previous email
    - Briefly explain how the solution addresses the problem
    - Focus on how it can help the recipient's company and goals
    - Keep it ${wordCount} words
    
    Tone: ${
      tone === "Excited"
        ? "Optimistic and enthusiastic"
        : tone === "Formal"
        ? "Professional and informative"
        : "Optimistic and informative"
    }
    
    Context:
    Previous Emails: ${previousEmails}
    Available Facts: ${senderDetails.company?.facts_and_figures || ""}

    IMPORTANT: Use actual names provided in the context for sender and receiver.
    
    Write paragraph 2 (${wordCount} words) in a ${tone.toLowerCase()} tone.
  `;
  paragraphs.paragraph_2 = await generateEmailComponent(p2Prompt);

  // Paragraph 3
  const p3Prompt = `
    Paragraph 3 - Propose a meeting or next steps clearly and politely
    
    Rules:
    - Suggest a time frame and show flexibility
    - Provide a clear next step
    - Offer flexibility in scheduling
    - Keep it ${wordCount} words
    
    Tone: ${
      tone === "Excited"
        ? "Friendly, inviting, and enthusiastic"
        : tone === "Formal"
        ? "Professional, inviting, and eager"
        : "Friendly, inviting, and eager to continue the conversation"
    }
    
    Context:
    Previous Emails: ${previousEmails}
    Sender Availability: ${senderDetails.availability || ""}

    IMPORTANT: Use actual names provided in the context for sender and receiver.
    
    Write paragraph 3 (${wordCount} words) in a ${tone.toLowerCase()} tone.
  `;
  paragraphs.paragraph_3 = await generateEmailComponent(p3Prompt);

  return {
    subject,
    body: paragraphs,
    full_email: Object.values(paragraphs).join("\n\n"),
  };
}

async function generateEmail4(
  senderDetails,
  receiverDetails,
  previousEmails = "",
  tone = "Casual",
  length = "Medium Length"
) {
  const paragraphs = {};

  // Determine word count based on length
  const getWordCount = (length) => {
    switch (length) {
      case "Short & Concise":
        return "40-60";
      case "Long & Informative":
        return "80-100";
      case "Medium Length":
      default:
        return "60-80";
    }
  };

  const wordCount = getWordCount(length);

  // Generate Subject
  const subjectPrompt = `
    Create a compelling subject line for an email introducing a proprietary solution.
    
    Rules:
    - Keep it short (4-7 words)
    - Hint at a valuable solution or insight
    - Make it intriguing but professional
    - Use a ${tone.toLowerCase()} tone
    - Don't be too salesy or pushy
    
    Context:
    Previous Emails: ${previousEmails}
    Sender: ${senderDetails.person?.name || ""}
    Receiver: ${receiverDetails.person?.name || ""}
    
    Write a compelling subject line in a ${tone.toLowerCase()} tone.
  `;
  const subject = await generateEmailComponent(subjectPrompt);

  // Paragraph 1
  const p1Prompt = `
    Write a FollowUP Email with 4 paragraphs introducing a proprietary solution.
    
    Paragraph 1 - Introduce a relatable scenario highlighting a familiar activity but pointing out a critical oversight
    
    Rules:
    - Open by addressing a common action the reader's team is likely doing
    - Identify a gap in their process
    - Mention potential benefits they're missing out on
    - Keep paragraph between ${wordCount} words
    
    Tone: ${tone.toLowerCase()} and informative
    
    Tone Guidelines:
    ${tone === "Humorous" ? "- Include light humor or witty observations" : ""}
    ${tone === "Diplomatic" ? "- Use measured, respectful language" : ""}
    ${
      tone === "Formal"
        ? "- Maintain professional, business-appropriate language"
        : ""
    }
    ${
      tone === "Casual" ? "- Keep it relaxed, friendly, and conversational" : ""
    }
    ${tone === "Excited" ? "- Use enthusiastic, energetic language" : ""}
    
    Context:
    Previous Emails: ${previousEmails}
    Available Facts: ${senderDetails.company?.facts_and_figures || ""}

    IMPORTANT: Use actual names provided in the context for sender and receiver.
    
    Write paragraph 1 (${wordCount} words) in a ${tone.toLowerCase()} tone.
  `;
  paragraphs.paragraph_1 = await generateEmailComponent(p1Prompt);

  // Paragraph 2
  const p2Prompt = `
    Paragraph 2 - Share credibility and authority by explaining personal experience or proven approach
    
    Rules:
    - Mention a proprietary method used successfully at many companies
    - Include tangible outcomes like creating new streams of MQLs
    - Keep paragraph between ${wordCount} words
    
    Tone: ${
      tone === "Excited"
        ? "Confident, experienced, and enthusiastic"
        : tone === "Formal"
        ? "Confident, experienced, and professional"
        : "Confident and experienced"
    }
    
    Context:
    Previous Emails: ${previousEmails}
    Available Facts: ${senderDetails.company?.facts_and_figures || ""}

    IMPORTANT: Use actual names provided in the context for sender and receiver.
    
    Write paragraph 2 (${wordCount} words) in a ${tone.toLowerCase()} tone.
  `;
  paragraphs.paragraph_2 = await generateEmailComponent(p2Prompt);

  // Paragraph 3
  const p3Prompt = `
    Paragraph 3 - Introduce the name of the process or solution with a branded name
    
    Rules:
    - Reveal the name making it sound catchy and easy to remember
    - Emphasize this is just one of many tools offered
    - Explain full support and customization will be provided
    - Keep paragraph between ${wordCount} words
    
    Tone: ${
      tone === "Excited"
        ? "Excited, engaging, and enthusiastic"
        : tone === "Formal"
        ? "Professional, engaging, and confident"
        : "Excited and engaging"
    }
    
    Context:
    Previous Emails: ${previousEmails}
    Available Facts: ${senderDetails.company?.facts_and_figures || ""}

    IMPORTANT: Use actual names provided in the context for sender and receiver.
    
    Write paragraph 3 (${wordCount} words) in a ${tone.toLowerCase()} tone.
  `;
  paragraphs.paragraph_3 = await generateEmailComponent(p3Prompt);

  // Paragraph 4
  const p4Prompt = `
    Paragraph 4 - Extend an invitation to discuss the solution further
    
    Rules:
    - Propose a friendly meeting without being pushy
    - Mention in-person option to keep it casual
    - Use friendly language like 'coffee chat'
    - Keep paragraph between ${wordCount} words
    
    Tone: ${
      tone === "Excited"
        ? "Friendly, approachable, and enthusiastic"
        : tone === "Formal"
        ? "Professional, approachable, and respectful"
        : "Friendly and approachable"
    }
    
    Context:
    Previous Emails: ${previousEmails}
    Sender Availability: ${senderDetails.availability || ""}

    IMPORTANT: Use actual names provided in the context for sender and receiver.
    
    Write paragraph 4 (${wordCount} words) in a ${tone.toLowerCase()} tone.
  `;
  paragraphs.paragraph_4 = await generateEmailComponent(p4Prompt);

  return {
    subject,
    body: paragraphs,
    full_email: Object.values(paragraphs).join("\n\n"),
  };
}

// Main Supabase Edge Function handler
Deno.serve(async (req) => {
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

    // Parse request data
    const data = await req.json();
    const {
      campaign_id,
      emailPreference = {},
      lead,
      previous_emails = "",
    } = data;

    // Validate required fields
    if (!campaign_id || !lead) {
      return new Response(
        JSON.stringify({
          error: "Missing required campaign_id or lead data",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Extract email preferences
    const {
      toneOption = "Casual",
      lengthOption = "Medium Length",
      emailType = "Introduction",
    } = emailPreference;

    // Fix typo in length option
    const normalizedLengthOption =
      lengthOption === "Short & Consise" ? "Short & Concise" : lengthOption;

    // Fetch campaign data to get sender details
    const { data: campaignData, error: campaignError } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaign_id)
      .eq("user_id", userId)
      .single();

    if (campaignError) {
      return new Response(JSON.stringify({ error: campaignError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch progress data for additional sender context
    const { data: progressData, error: progressError } = await supabase
      .from("campaign_progress")
      .select("*")
      .eq("id", campaignData.progress_id)
      .single();

    if (progressError) {
      return new Response(JSON.stringify({ error: progressError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const {
      step_5_result: {
        linkedin_profile: { full_name: sender_name },
      },
    } = progressData;

    // Transform lead data into receiver_details format
    const receiver_details = {
      person: {
        name: lead.full_name || `${lead.first_name} ${lead.last_name}`,
        facts: `${lead.summary || ""} ${lead.headline || ""} ${
          lead.jobs?.map((job) => job.job_description).join(" ") || ""
        } ${
          lead.insights?.personInsights?.awards
            ?.map((award) => award.description)
            .join(" ") || ""
        } ${
          lead.insights?.personInsights?.relevantInsights
            ?.map((insight) => insight.description)
            .join(" ") || ""
        } ${
          lead.insights?.personInsights?.onlineMentions
            ?.map((mention) => mention.summary)
            .join(" ") || ""
        }`.trim(),
      },
      company: {
        name: lead.company_name,
        details: lead.company_description || "",
        facts_and_figures: `${
          lead.insights?.businessInsights?.detail
            ? `Revenue: $${lead.insights.businessInsights.detail.revenue}, Employees: ${lead.insights.businessInsights.detail.employees}, Industry: ${lead.insights.businessInsights.detail.industry}`
            : ""
        } 
          ${
            lead.insights?.businessInsights?.insights
              ?.map((insight) => insight.description)
              .join(" ") || ""
          } 
          ${
            lead.insights?.businessInsights?.whyNow
              ?.map((why) => why.why_now)
              .join(" ") || ""
          } 
          ${
            lead.insights?.businessInsights?.commonalities
              ?.map((common) => common.description)
              .join(" ") || ""
          }`.trim(),
      },
    };

    // Transform campaign/progress data into sender_details format
    const sender_details = {
      person: {
        name: sender_name || "Your Name",
        facts:
          progressData.sender_bio ||
          "Experienced professional in data solutions and business transformation",
      },
      company: {
        name: progressData.company_name || "Artha Solutions",
        details:
          progressData.company_description ||
          "Leading provider of data analytics and business transformation solutions",
        facts_and_figures:
          progressData.company_metrics ||
          "Successfully delivered 300+ global projects, 50% reduction in data processing time, 65% improvement in data accuracy",
      },
      availability:
        progressData.availability ||
        "Available for meetings Monday-Friday, 9 AM - 5 PM EST",
    };

    // Map frontend email types to internal functions
    const emailTypeMap = {
      Introduction: "email1",
      "Follow up": "email2",
      "Book a meeting": "email3",
      Proposal: "email4",
      "Thank you": "email2", // Using email2 for thank you notes
    };

    const internalEmailType = emailTypeMap[emailType] || "email1";

    // Generate email based on type with tone and length parameters
    let result;
    switch (internalEmailType) {
      case "email1":
        result = await generateEmail1(
          sender_details,
          receiver_details,
          toneOption,
          normalizedLengthOption
        );
        break;
      case "email2":
        result = await generateEmail2(
          sender_details,
          receiver_details,
          previous_emails,
          toneOption,
          normalizedLengthOption
        );
        break;
      case "email3":
        result = await generateEmail3(
          sender_details,
          receiver_details,
          previous_emails,
          toneOption,
          normalizedLengthOption
        );
        break;
      case "email4":
        result = await generateEmail4(
          sender_details,
          receiver_details,
          previous_emails,
          toneOption,
          normalizedLengthOption
        );
        break;
      default:
        return new Response(
          JSON.stringify({ error: `Unsupported email type: ${emailType}` }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    return new Response(
      JSON.stringify({
        success: true,
        campaign_id,
        email_type: emailType,
        tone: toneOption,
        length: normalizedLengthOption,
        result,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message,
        success: false,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/email-generation' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
