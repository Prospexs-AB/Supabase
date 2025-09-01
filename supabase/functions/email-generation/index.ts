// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "npm:openai";
import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

// Configuration
const CONFIG = {
  MODELS: {
    GPT4: "gpt-4o",
    GPT4_MINI: "gpt-4o-mini",
    FINETUNED_HPEF:
      "ft:gpt-4o-mini-2024-07-18:prospexs:hpef-condensed:A1ScOMrW",
    FINETUNED_TTB:
      "ft:gpt-4o-mini-2024-07-18:prospexs:transitiontobusiness:A1DJJhy8",
  },
  TEMPERATURE: {
    CREATIVE: 1.0,
    BALANCED: 0.5,
    CONSISTENT: 0.1,
  },
};

// Utility Functions
class Utils {
  static async sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static getCurrentDay() {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const now = new Date();
    return `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
  }

  static cleanContent(text: string) {
    // Preserve paragraph breaks while trimming extra spaces
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = normalized.split("\n").map((line) => line.trim());
    // Collapse 3+ blank lines to 2, keep paragraph structure
    const compact = lines.join("\n").replace(/\n{3,}/g, "\n\n");
    // Collapse spaces/tabs within lines but keep newlines
    return compact.replace(/[ \t]+/g, " ").trim();
  }

  static stripSignOffs(
    text: string,
    senderName?: string,
    companyName?: string
  ) {
    const lines = text.split("\n");
    const signOffPattern =
      /^(best regards|best|regards|sincerely|thanks|thank you|cheers)[,\s]*$/i;
    const placeholderNamePattern = /^\s*\[?your name\]?\s*$/i;
    const looksLikeSignature = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (placeholderNamePattern.test(trimmed)) return true;
      if (
        senderName &&
        trimmed.toLowerCase().includes(senderName.toLowerCase())
      )
        return true;
      if (
        companyName &&
        trimmed.toLowerCase().includes(companyName.toLowerCase())
      )
        return true;
      // Common title keywords
      if (
        /(lead|manager|director|engineer|analyst|consultant|founder|ceo|cto|technical|sales|marketing)/i.test(
          trimmed
        )
      )
        return true;
      return false;
    };

    const output: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isSignOff = signOffPattern.test(line.trim());

      // Remove explicit placeholders like "Best, [Your Name]" on one line
      if (
        /^(best( regards)?|regards|sincerely|thanks|thank you|cheers)[,\s]*\[?your name\]?/i.test(
          line.trim()
        )
      ) {
        continue;
      }

      if (isSignOff) {
        // If next line looks like a signature (name/title/company), skip it too
        const nextLine = i + 1 < lines.length ? lines[i + 1] : "";
        if (looksLikeSignature(nextLine)) {
          i++; // skip next line
        }
        continue; // skip sign-off line
      }
      output.push(line);
    }

    return output.join("\n");
  }

  static normalizeToneOption(tone?: string) {
    const t = (tone || "Professional").toLowerCase();
    if (t.includes("humor")) return "Humorous";
    if (t.includes("diplomatic")) return "Diplomatic";
    if (t.includes("formal")) return "Formal";
    if (t.includes("casual") || t.includes("friendly")) return "Casual";
    if (t.includes("excited") || t.includes("enthusiastic")) return "Excited";
    if (t.includes("professional")) return "Professional";
    return "Professional";
  }

  static normalizeLengthOption(length?: string) {
    const l = (length || "Medium Length").toLowerCase();
    if (l.includes("short")) return "Short & Concise";
    if (l.includes("long")) return "Long & Informative";
    return "Medium Length";
  }

  static getPreferences(tone?: string, length?: string, emailType?: string) {
    return {
      tone: this.normalizeToneOption(tone),
      length: this.normalizeLengthOption(length),
      emailType: (emailType || "Full").toString(),
    };
  }

  static getTemperatureForTone(tone?: string) {
    const t = this.normalizeToneOption(tone);
    if (t === "Humorous" || t === "Excited") return CONFIG.TEMPERATURE.CREATIVE;
    if (t === "Casual") return CONFIG.TEMPERATURE.BALANCED;
    if (t === "Formal" || t === "Diplomatic")
      return CONFIG.TEMPERATURE.CONSISTENT;
    return CONFIG.TEMPERATURE.BALANCED;
  }

  static getSentenceRange(length?: string) {
    const l = this.normalizeLengthOption(length);
    if (l === "Short & Concise") return { min: 1, max: 2 };
    if (l === "Long & Informative") return { min: 5, max: 7 };
    return { min: 2, max: 4 };
  }

  static getSentenceInstruction(length?: string) {
    const { min, max } = this.getSentenceRange(length);
    return `Limit to ${min}-${max} sentences`;
  }

  static getToneInstruction(tone?: string) {
    const t = this.normalizeToneOption(tone);
    if (t === "Humorous")
      return "Use a humorous tone (light, tasteful, and professional-safe)";
    if (t === "Diplomatic")
      return "Use a diplomatic tone (balanced, considerate, non-confrontational)";
    if (t === "Excited")
      return "Use an excited tone (positive and energetic, without hype)";
    return `Use a ${t.toLowerCase()} tone`;
  }

  static getMaxTokens(length: string | undefined, base: number) {
    const l = this.normalizeLengthOption(length);
    if (l === "Short & Concise") return Math.min(base, 160);
    if (l === "Long & Informative") return base + 120;
    return base;
  }

  static getGreetingForTone(tone: string | undefined, name: string) {
    const t = this.normalizeToneOption(tone);
    if (t === "Formal" || t === "Diplomatic") return `Dear ${name},`;
    return `Hi ${name},`;
  }

  static getClosingForTone(tone: string | undefined) {
    const t = this.normalizeToneOption(tone);
    if (t === "Formal" || t === "Diplomatic") return "Sincerely,";
    if (t === "Casual" || t === "Humorous") return "Thanks,";
    return "Best regards,";
  }
}

async function createOpenAICompletion(
  openai: OpenAI,
  options: {
    model: string;
    messages: any[];
    temperature?: number;
    max_tokens?: number;
    n?: number;
  }
) {
  let result;
  try {
    console.log("Sending request to OpenAI API...");
    const completion = await openai.chat.completions.create(options);
    result = completion.choices[0].message.content;
    console.log("OpenAI response:", result);
  } catch (error) {
    console.log("Error OpenAI:", error);
    console.log("Sending request to Anthropic API...");
    const client = new Anthropic({
      apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
    });
    const userPrompt = options.messages.filter(
      (message) => message.role === "user"
    );
    console.log("User prompt:", userPrompt);
    const anthropicResponse = await client.messages.create({
      model: "claude-3-7-sonnet-20250219",
      max_tokens: 4096,
      system:
        "You are an assistant that will follow the user's instructions and not return any extra info or markdown formatting. You will not return any markdown and will only return the subject or paragraph requet because some prompt results will be combined with other responses and you want it to sound natural. You will not return the subject line in the response. You will translate the response to the requested language in the prompt",
      messages: userPrompt,
    });
    result = anthropicResponse.content[0].text;
    console.log("Anthropic response:", result);
  }
  return result;
}

function renderTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}|\{(\w+)\}/g, (_m, a, b) => {
    const key = a || b;
    return vars[key] ?? "";
  });
}

// Inline prompt templates copied from email/ directory
const PROMPTS = {
  subject: {
    // No dedicated subject template found that matches our usage.
    // Keeping inline prompt in Subject.buildPrompt below.
  },
  ttb: {
    context: `## CONTEXT
      **Receiver Company Facts and Figures:**  
      {receiver_company_facts_and_figures}

      **Company Problems and Solutions:**  
      {problems_solutions}

      **Clients and Partners:**  
      {clients_and_partners}

      **Sender and Receiver Details:**  
      {sender_and_receiver_details}

      **Other parts of the email:**  
      {other_parts_of_email}

      `,
    examples: `## SENDER's WRITING STYLE:
      The sender uses a friendly and conversational tone, connecting personally with the recipient before transitioning to a business-related challenge. The goal is to create a natural flow into the topic of discussion without immediately offering a solution.

      **Sample transition to business paragraphs:**  
      \`\`\`
      {examples}
      \`\`\`
      `,
    system: {
      en: `## **Transition to Business:**
      In this section, the sender smoothly transitions from a personal touch to addressing a specific business challenge the recipient might be facing. The transition should:

      - **Casual Opener:** Start with a relatable comment about recent activities, news, or trends related to their company, connecting this to the HPEF.
      - **Introduce the Challenge (Backed by Data):** Highlight a concrete challenge the recipient’s company may be dealing with, supported by **facts and figures provided**. **No hypothesis or assumptions should be made.**
      - **Build Empathy:** Acknowledge the difficulty or effort required to manage this challenge, showing understanding and appreciation for their efforts.
      - **Lay-Up for a Solution:** Prepare the recipient for a solution without directly presenting it.

      **Today's Date**
      {current_day}

      ## **Rules:**
      - Keep the tone friendly, casual, and highly personalized.
      - Be specific to the recipient and their company.
      - Ensure the paragraph is concise (150-250 words) with 2-4 sentences.
      - Make the content feel exclusive and directly relevant to the recipient.
      - Avoid offering the value proposition in this section.
      - **Use the provided facts and figures to support the TTB. Do not make assumptions or hypothesize about challenges.**

      ### **Points for Better Writing:**
      - Use a conversational, informal tone with contractions for a natural feel.
      - Include specific examples or references related to the recipient’s context.
      - Build a personal connection, showing understanding or shared interests.
      - Use clear, straightforward language, avoiding jargon and complex structures.
      - Engage the reader with direct questions if relevant.
      - Only include a time-based greeting (e.g., ‘Have a great weekend!’) if it is relevant to the **Today's Date**

      ### **Words/Sentences to Avoid:**
      - Avoid phrases such as:
          - Streamlining these processes
          - Operational efficiency
          - I recently came across
          - I admire your
          - Curious to hear more about your
          - Deeply excited to
          - Looking forward to
          - As someone who
          - Navigating the challenges
          - Product efficiency
          - Exhilarating
          - Resonated with me
      - Avoid exaggerated or overly formal language; keep it conversational.
      - Refrain from using fluff words like resonate, streamline, operational efficiency, etc.

      ### **Write the following text in a natural, relaxed, and conversational tone.**
      1. Avoid overly formal or technical language – the writing should feel approachable and easy to read, as if you're speaking directly to the reader.
      2. Focus on clarity and flow – make sure the sentences flow smoothly and are easy to understand. Rephrase any awkward or stiff wording to sound more natural in everyday English.
      3. Choose modern, commonly used words and phrases – avoid outdated or overly complex terms. If something feels too formal, rephrase it to make it sound more natural and relatable. For example, instead of saying “telecommuting,” use “remote work” for a more current and conversational tone.
      4. Be mindful of tone – keep the tone friendly and engaging. The text should feel approachable and personal, as if you're having a conversation with the reader.

      **Note:** The Transition to Business paragraph should smoothly introduce and highlight a specific challenge faced by the recipient without presenting the sender's solution.
      `,
      sv: `## **Transition to Business:**
      In this section, the sender smoothly transitions from a personal touch to addressing a specific business challenge the recipient might be facing. The transition should:

      - **Casual Opener:** Start with a relatable comment about recent activities, news, or trends related to their company, connecting this to the HPEF.
      - **Introduce the Challenge (Backed by Data):** Highlight a concrete challenge the recipient’s company may be dealing with, supported by **facts and figures provided**. **No hypothesis or assumptions should be made.**
      - **Build Empathy:** Acknowledge the difficulty or effort required to manage this challenge, showing understanding and appreciation for their efforts.
      - **Lay-Up for a Solution:** Prepare the recipient for a solution without directly presenting it.

      **Today's Date**
      {current_day}

      ## **Rules:**
      - Keep the tone friendly, casual, and highly personalized.
      - Be specific to the recipient and their company.
      - Ensure the paragraph is concise (150-250 words) with 2-4 sentences.
      - Make the content feel exclusive and directly relevant to the recipient.
      - Avoid offering the value proposition in this section.
      - **Use the provided facts and figures to support the TTB. Do not make assumptions or hypothesize about challenges.**
      - Only include a time-based greeting (e.g., ‘Have a great weekend!’) if it is relevant to the **Today's Date**

      ### **Points for Better Writing:**
      - Use a conversational, informal tone with contractions for a natural feel.
      - Include specific examples or references related to the recipient’s context.
      - Build a personal connection, showing understanding or shared interests.
      - Use clear, straightforward language, avoiding jargon and complex structures.
      - Engage the reader with direct questions if relevant.

      ### **Words/Sentences to Avoid:**
      - Avoid phrases such as:
          - Streamlining these processes
          - Operational efficiency
          - I recently came across
          - I admire your
          - Curious to hear more about your
          - Deeply excited to
          - Looking forward to
          - As someone who
          - Navigating the challenges
          - Product efficiency
          - Exhilarating
          - Resonated with me
      - Avoid exaggerated or overly formal language; keep it conversational.
      - Refrain from using fluff words like resonate, streamline, operational efficiency, etc.

      **Note:** The Transition to Business paragraph should smoothly introduce and highlight a specific challenge faced by the recipient without presenting the sender's solution.
      `,
    },
  },
  objection: {
    context: `## CONTEXT

      **Sender company details:**
      {sender_company_details}

      **Receiver cmpany details:**
      {receiver_commpany_details}

      **Sender and Receiver Details:**
      {sender_and_receiver_details}

      **Other parts of the email:**
      {other_parts_of_email}

      **Clients and Partners:**
      {clients_and_partners}

      `,
    examples: `## SENDER's WRITING STYLE:
      Below are sample paragraphs that demonstrate how the sender acknowledges potential concerns and positions their solution as a natural enhancement to existing processes, addressing objections while highlighting added value.

      **Sample Objection handling paragraphs:**  

      \`\`\`
      {examples}
      \`\`\`
      `,
    system: {
      en: `---
      ## **Task:**
      Write a 30-55 word paragraph that addresses the receiver's existing setup or solution while introducing the sender’s offering.

      **Today's Date**
      {current_day}

      ### **Key Points to Cover:**

      - **Acknowledge Existing Setup:** Start by recognizing the receiver’s current solution, showing respect for their efforts.
      - **Complement & Enhance:** Transition into how the sender’s solution seamlessly complements and improves their current setup.
      - **Highlight Benefits:** Briefly touch on unique benefits, using specific, tangible outcomes like increased efficiency or relevant statistics.
      - **Current Usage Recognition:** If the receiver is using a similar solution, note this and explain how the sender’s product adds more value.
      - **Client/Partner Recognition:** Mention the receiver’s notable clients or partners, appreciating them while suggesting how the sender’s offering can enhance those relationships.
      - **Facts & Figures:** Include concrete facts or figures that show the sender’s offering has delivered measurable results to similar clients or partners.

      ---

      ## **Rules:**

      - Reference the **Transition to Business (TTB)** and **Value Proposition** sections to understand the challenge and solution being addressed, but do **not** reuse content directly.
      - Be as specific as possible. Avoid vague terms like "operational efficiency" and instead focus on clear, concrete challenges.
      - Use relevant details like employee count or other metrics from the context.
      - Recognize the receiver’s existing clients/partners (if not already mentioned in TTB or Value Proposition) and explain how the sender’s solution can help enhance those relationships.
      - Always back up the paragraph with **facts or figures** to support the claims.
      - If the receiver already uses a similar tool/service, acknowledge this and show how the sender’s solution adds more value.
      - The tone should be **friendly, casual, and conversational**—avoid sounding too formal or like a sales pitch.
      - When using the receiver’s company name, shorten it (e.g., "Lendo" instead of "Lendo AB").

      ---

      ## **Instructions:**

      - **Do not copy** or directly reuse content from the **Transition to Business (TTB)** or **Value Proposition** sections. The **Objection Handling** paragraph should be distinct but related to addressing the same challenge and solution.
      - Be proactive in handling objections: acknowledge the receiver’s current setup, then position the sender’s solution as an enhancement, not a disruption.
      - Highlight what sets the sender’s offering apart, focusing on specific benefits that align with the receiver's challenges.
      - Keep the tone **casual and conversational**: simple sentence structures, easy-to-follow language, and a natural flow that feels like a relaxed chat.
      - Only include a time-based greeting (e.g., ‘Have a great weekend!’) if it is relevant to the **Today's Date**

      ---

      ### **Tone:**

      - Keep the paragraph **casual and conversational**—relaxed, easy to read, and more like a friendly chat than formal communication.
      - Return the pagaraph of the Objection Handling.

      ---

      ### **Write the following text in a natural, relaxed, and conversational tone.**
      1. Avoid overly formal or technical language – the writing should feel approachable and easy to read, as if you're speaking directly to the reader.
      2. Focus on clarity and flow – make sure the sentences flow smoothly and are easy to understand. Rephrase any awkward or stiff wording to sound more natural in everyday English.
      3. Choose modern, commonly used words and phrases – avoid outdated or overly complex terms. If something feels too formal, rephrase it to make it sound more natural and relatable. For example, instead of saying “telecommuting,” use “remote work” for a more current and conversational tone.
      4. Be mindful of tone – keep the tone friendly and engaging. The text should feel approachable and personal, as if you're having a conversation with the reader.
      `,
      sv: `---
      ## **Task:**
      Write a 30-55 word paragraph that addresses the receiver's existing setup or solution while introducing the sender’s offering.

      **Today's Date**
      {current_day}

      ### **Key Points to Cover:**

      - **Acknowledge Existing Setup:** Start by recognizing the receiver’s current solution, showing respect for their efforts.
      - **Complement & Enhance:** Transition into how the sender’s solution seamlessly complements and improves their current setup.
      - **Highlight Benefits:** Briefly touch on unique benefits, using specific, tangible outcomes like increased efficiency or relevant statistics.
      - **Current Usage Recognition:** If the receiver is using a similar solution, note this and explain how the sender’s product adds more value.
      - **Client/Partner Recognition:** Mention the receiver’s notable clients or partners, appreciating them while suggesting how the sender’s offering can enhance those relationships.
      - **Facts & Figures:** Include concrete facts or figures that show the sender’s offering has delivered measurable results to similar clients or partners.

      ---

      ## **Rules:**

      - Reference the **Transition to Business (TTB)** and **Value Proposition** sections to understand the challenge and solution being addressed, but do **not** reuse content directly.
      - Be as specific as possible. Avoid vague terms like "operational efficiency" and instead focus on clear, concrete challenges.
      - Use relevant details like employee count or other metrics from the context.
      - Recognize the receiver’s existing clients/partners (if not already mentioned in TTB or Value Proposition) and explain how the sender’s solution can help enhance those relationships.
      - Always back up the paragraph with **facts or figures** to support the claims.
      - If the receiver already uses a similar tool/service, acknowledge this and show how the sender’s solution adds more value.
      - The tone should be **friendly, casual, and conversational**—avoid sounding too formal or like a sales pitch.
      - When using the receiver’s company name, shorten it (e.g., "Lendo" instead of "Lendo AB").

      ---

      ## **Instructions:**

      - **Do not copy** or directly reuse content from the **Transition to Business (TTB)** or **Value Proposition** sections. The **Objection Handling** paragraph should be distinct but related to addressing the same challenge and solution.
      - Be proactive in handling objections: acknowledge the receiver’s current setup, then position the sender’s solution as an enhancement, not a disruption.
      - Highlight what sets the sender’s offering apart, focusing on specific benefits that align with the receiver's challenges.
      - Keep the tone **casual and conversational**: simple sentence structures, easy-to-follow language, and a natural flow that feels like a relaxed chat.
      `,
    },
  },
  cta: {
    context: `## CONTEXT

      **Sender and Receiver Details:**
      {sender_and_receiver_details}

      **Senders availability:**
      {sender_availability}

      **Other parts of the email:**
      {other_parts_of_email}

      `,
    examples: `## SENDER's WRITING STYLE:
      "Below are examples of how the sender typically crafts Call to Action (CTA) paragraphs." 

      **Sample CTA paragraphs:**  

      \`\`\`
      {examples}
      \`\`\`
      `,
    system: {
      en: `## **Task:**
      Write a 30-50 word Call to Action (CTA) paragraph that invites the receiver to schedule a meeting or a call.

      **Today's Date**
      {current_day}

      ### **Key Points to Cover:**
      - A friendly, conversational tone.
      - Specific mention of the receiver's name.
      - Reference to the purpose of the meeting (e.g., exploring synergies, discussing how the sender’s solution can benefit the receiver). Refer to the **Subject, HPEF, Transition to Business, Value Proposition, and Objection Handling** sections to understand the context and purpose.
      - Optionally, include a personal touch (e.g., asking about an interest of the receiver or referencing shared experiences).
      - Ask for a time which suits the receiver for a quick call or chat.
      - Also, ask in the end if the receiver has any related questions or wants to ask anything.

      ## **Rules:**
      1. Keep the tone casual but respectful, avoiding overly formal language.
      2. Use straightforward and simple sentence structures.
      3. Avoid sounding pushy; instead, focus on collaboration and exploration.
      4. When using the receiver’s company name, shorten it (e.g., "Lendo" instead of "Lendo AB").

      ## **Instructions:**
      - The CTA should be concise, between 30 and 50 words.
      - Personalize the message by using the **recipient’s first name in the middle of the paragraph**, and if relevant, include a personal detail.
      - Reference the goal of the meeting in a way that feels organic, not sales-driven.
      - Only include a time-based greeting (e.g., ‘Have a great weekend!’) if it is relevant to the **Today's Date**
        
      ### **Tone:**
      Maintain a breezy, conversational tone throughout the paragraph. It should feel friendly and flexible, while keeping the meeting request clear and specific.

      ### **Write the following text in a natural, relaxed, and conversational tone.**
      1. Avoid overly formal or technical language – the writing should feel approachable and easy to read, as if you're speaking directly to the reader.
      2. Focus on clarity and flow – make sure the sentences flow smoothly and are easy to understand. Rephrase any awkward or stiff wording to sound more natural in everyday English.
      3. Choose modern, commonly used words and phrases – avoid outdated or overly complex terms. If something feels too formal, rephrase it to make it sound more natural and relatable. For example, instead of saying “telecommuting,” use “remote work” for a more current and conversational tone.
      4. Be mindful of tone – keep the tone friendly and engaging. The text should feel approachable and personal, as if you're having a conversation with the reader.

      ### **Format:**
      - CTA paragraph
      `,
      sv: `## **Task:**
      Write a 30-50 word Call to Action (CTA) paragraph that invites the receiver to schedule a meeting or a call.

      **Today's Date**
      {current_day}

      ### **Key Points to Cover:**
      - A friendly, conversational tone.
      - Specific mention of the receiver's name.
      - Reference to the purpose of the meeting (e.g., exploring synergies, discussing how the sender’s solution can benefit the receiver). Refer to the **Subject, HPEF, Transition to Business, Value Proposition, and Objection Handling** sections to understand the context and purpose.
      - Optionally, include a personal touch (e.g., asking about an interest of the receiver or referencing shared experiences).
      - Ask for a time which suits the receiver for a quick call or chat.
      - Also, ask in the end if the receiver has any related questions or wants to ask anything.

      ## **Rules:**
      1. Keep the tone casual but respectful, avoiding overly formal language.
      2. Use straightforward and simple sentence structures.
      3. Avoid sounding pushy; instead, focus on collaboration and exploration.
      4. When using the receiver’s company name, shorten it (e.g., "Lendo" instead of "Lendo AB").

      ## **Instructions:**
      - The CTA should be concise, between 30 and 50 words.
      - Personalize the message by using the **recipient’s first name in the middle of the paragraph**, and if relevant, include a personal detail.
      - Reference the goal of the meeting in a way that feels organic, not sales-driven.
      - Only include a time-based greeting (e.g., ‘Have a great weekend!’) if it is relevant to the **Today's Date**
        
      ### **Tone:**
      Maintain a breezy, conversational tone throughout the paragraph. It should feel friendly and flexible, while keeping the meeting request clear and specific.

      ### **Format:**
      - CTA paragraph
      `,
    },
  },
} as const;

// Base Email Part Class
class EmailPart {
  content: string;
  context: string;
  language: string;
  explanation: string;
  options: string[];

  constructor(content: string, options: any = {}) {
    this.content = content;
    this.context = options.context || "";
    this.language = options.language || "en";
    this.explanation = options.explanation || "";
    this.options = options.options || [];
  }

  cleanContent() {
    this.content = Utils.cleanContent(this.content);
    return this;
  }

  toText() {
    return this.content;
  }

  toMarkdown() {
    return `**${this.constructor.name}:**\n\n${this.content}`;
  }
}

// Subject Class
class Subject extends EmailPart {
  static async fromDetailsAndContexts(
    details: any,
    contexts: any,
    openai: OpenAI
  ) {
    const prompt = await this.buildPrompt(details, contexts);

    const completion = await createOpenAICompletion(openai, {
      model: CONFIG.MODELS.GPT4_MINI,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.CONSISTENT,
      max_tokens: 100,
    });

    return new Subject(completion || "", {
      context: prompt,
      language: details.language,
    });
  }

  static async buildPrompt(details: any, contexts: any) {
    // Fallback to inline subject template if not provided elsewhere
    return `
    Generate a compelling email subject line for a professional outreach email.

    Sender: ${details.sender.person.name} (${
      details.sender.person.designation
    }) at ${details.sender.company.name}
    Receiver: ${details.receiver.person.name} (${
      details.receiver.person.designation
    }) at ${details.receiver.company.name}

    Context: ${contexts.email || "Professional business outreach"}

    Requirements:
    - Keep it under 60 characters
    - Be professional and engaging
    - Avoid spam trigger words
    - Be specific and relevant
    - Return ONLY the subject line, no additional text
    - Return in this language: ${contexts.language}

    Subject line:`;
  }

  toText() {
    return this.content;
  }
}

// HPEF (Hyper Personalized Engagement Framework)
class HPEF extends EmailPart {
  static async fromDetails(details: any, openai: OpenAI, options: any = {}) {
    const { useFinetuned = false } = options;

    if (useFinetuned) {
      return await this.getFinetunedHPEF(details, openai);
    } else {
      return await this.getStoryLikeHPEF(details, openai);
    }
  }

  static async getStoryLikeHPEF(details: any, openai: OpenAI) {
    const stories = await this.generateStories(details, openai, 1, 2);
    const bestStory = await this.selectBestStory(
      stories,
      details.language,
      openai,
      details
    );

    return new HPEF(bestStory.content, {
      context: this.getContext(details),
      language: details.language,
      options: stories.map((s: any) => s.content),
    }).cleanContent();
  }

  static async generateStories(
    details: any,
    openai: OpenAI,
    start: number = 1,
    end: number = 2
  ) {
    const stories = [];
    for (let i = start; i <= end; i++) {
      const story = await this.generateSingleStory(details, openai, i);
      stories.push(story);
    }
    return stories;
  }

  static async generateSingleStory(
    details: any,
    openai: OpenAI,
    storyId: number
  ) {
    const prompt = this.buildStoryPrompt(details, storyId);

    const completion = await createOpenAICompletion(openai, {
      model: CONFIG.MODELS.GPT4,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.BALANCED,
      max_tokens: 300,
    });

    const refinedStory = await this.rewriteHPEF(
      completion || "",
      details.language,
      openai,
      details
    );

    return refinedStory;
  }

  static async rewriteHPEF(
    oldStory: string,
    language: string = "en",
    openai: OpenAI,
    details: any
  ) {
    const prompt = `
      Rewrite this email introduction to make it more concise and engaging:

      ${oldStory}

      Requirements:
      - Length: ${Utils.getSentenceInstruction(details.preferences?.length)}
      - Make it more personal and relevant
      - Tone: ${Utils.getToneInstruction(details.preferences?.tone)}
      - Return in this language: ${language}
      - Focus on building connection
      - Do NOT include any greetings or sign-offs (e.g., "Hi", "Dear", "Best", names/titles)
    `;

    const completion = await createOpenAICompletion(openai, {
      model: CONFIG.MODELS.GPT4_MINI,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.CREATIVE,
      max_tokens: 200,
    });

    return {
      content: completion || "",
    };
  }

  static async selectBestStory(
    stories: any[],
    language: string = "en",
    openai: OpenAI,
    details: any
  ) {
    const storiesText = stories
      .map((s, i) => `${i + 1}. ${s.content}`)
      .join("\n");

    const prompt = `
      Compare these email introductions and select the best one:

      ${storiesText}

      Select the best introduction based on:
      - Personalization quality
      - Engagement potential
      - Tone: ${Utils.getToneInstruction(details.preferences?.tone)}
      - Return in this language: ${language}
      - Length: ${Utils.getSentenceInstruction(details.preferences?.length)}
      - Relevance to business context

      Respond with only the number (1, 2, etc.) of the best option:
    `;

    const completion = await createOpenAICompletion(openai, {
      model: CONFIG.MODELS.GPT4_MINI,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.CONSISTENT,
      max_tokens: 50,
    });

    const selectedIndex = parseInt(completion?.match(/\d+/)?.[0] || "1") - 1;
    const selectedStory = stories[selectedIndex];

    return selectedStory;
  }

  static async getFinetunedHPEF(details: any, openai: OpenAI) {
    const prompt = this.buildFinetunedPrompt(details);

    const completions = await createOpenAICompletion(openai, {
      model: CONFIG.MODELS.FINETUNED_HPEF,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.BALANCED,
      max_tokens: 300,
      n: 3,
    });

    const hpefs = completions
      .map((choice: any) => choice)
      .filter((content: any) => content)
      .map((content: any) => this.parseFinetunedResponse(content))
      .filter((hpef: any) => hpef);

    if (hpefs.length === 0) {
      return await this.getStoryLikeHPEF(details, openai);
    }

    const bestHPEF = await this.selectBestStory(
      hpefs,
      details.language,
      openai,
      details
    );

    return new HPEF(bestHPEF.content, {
      context: this.getContext(details),
      language: details.language,
      explanation: bestHPEF.explanation || "",
      options: hpefs
        .filter((h: any) => h.content !== bestHPEF.content)
        .map((h: any) => h.content),
    }).cleanContent();
  }

  static parseFinetunedResponse(response: string) {
    const regex = /explanation:\s*(.*?)\s+hpef:\s*(.*)/s;
    const match = response.match(regex);

    if (match) {
      return {
        content: match[2].trim(),
        explanation: match[1].trim(),
      };
    }
    return null;
  }

  static buildStoryPrompt(details: any, storyId: number) {
    return `
      Generate a personalized email introduction paragraph for:

      Sender: ${details.sender.person.name} (${
      details.sender.person.designation
    }) at ${details.sender.company.name}
      Sender Context: ${
        details.sender.person.facts || "Professional in technology"
      }

      Receiver: ${details.receiver.person.name} (${
      details.receiver.person.designation
    }) at ${details.receiver.company.name}
      Receiver Context: ${
        details.receiver.person.facts || "Business professional"
      }

      Company Context: ${
        details.receiver.company.facts_and_figures || "Established company"
      }

      Create a story-like introduction that:
      - Builds a personal connection
      - Shows understanding of their business
      - Is relevant and engaging
      - Length: ${Utils.getSentenceInstruction(details.preferences?.length)}
      - Tone: ${Utils.getToneInstruction(details.preferences?.tone)}
      - Return in this language: ${details.language}
      - IMPORTANT: Do NOT include any greetings like "Hi", "Dear", or "Hello"
      - IMPORTANT: Do NOT include any sign-offs (e.g., "Best", "Regards", names/titles)
      - Return ONLY the introduction paragraph content
    `;
  }

  static buildFinetunedPrompt(details: any) {
    return `
      Generate a hyper-personalized email introduction.

      Sender: ${details.sender.person.name} (${
      details.sender.person.designation
    }) at ${details.sender.company.name}
      Sender Context: ${
        details.sender.person.facts || "Professional in technology"
      }

      Receiver: ${details.receiver.person.name} (${
      details.receiver.person.designation
    }) at ${details.receiver.company.name}
      Receiver Context: ${
        details.receiver.person.facts || "Business professional"
      }

      Company Context: ${
        details.receiver.company.facts_and_figures || "Established company"
      }

      Length: ${Utils.getSentenceInstruction(details.preferences?.length)}
      Tone: ${Utils.getToneInstruction(details.preferences?.tone)}

      Format your response as:
      explanation: [brief explanation of the approach]
      hpef: [the actual introduction text]`;
  }

  static getContext(details: any) {
    return `
      Sender: ${details.sender.person.name} at ${details.sender.company.name}
      Receiver: ${details.receiver.person.name} at ${details.receiver.company.name}
      Context: Professional business outreach
    `;
  }
}

// Value Proposition
class ValueProposition extends EmailPart {
  static async fromDetailsAndContexts(
    details: any,
    contexts: any,
    openai: OpenAI
  ) {
    const openaiResponse = await this.getFromOpenAI(details, contexts, openai);

    return new ValueProposition(openaiResponse.content, {
      context: this.getContext(details, contexts),
      language: details.language,
      options: [],
    }).cleanContent();
  }

  static async getFromOpenAI(details: any, contexts: any, openai: OpenAI) {
    const prompt = await this.buildOpenAIPrompt(details, contexts);

    const completion = await createOpenAICompletion(openai, {
      model: CONFIG.MODELS.GPT4_MINI,
      messages: [{ role: "user", content: prompt }],
      temperature: Utils.getTemperatureForTone(details.preferences?.tone),
      max_tokens: Utils.getMaxTokens(details.preferences?.length, 300),
    });

    return {
      content: completion || "",
    };
  }

  static async buildOpenAIPrompt(details: any, contexts: any) {
    return `
      Create a compelling value proposition paragraph for a business outreach email.

      Sender Company: ${details.sender.company.name}
      Sender Company Details: ${
        details.sender.company.details || "Technology solutions provider"
      }
      Sender Company Facts: ${
        details.sender.company.facts_and_figures ||
        "Established company with proven track record"
      }

      Receiver Company: ${details.receiver.company.name}
      Receiver Company Details: ${
        details.receiver.company.details || "Established business"
      }

      Requirements:
      - Make it specific and relevant to the receiver's business
      - Focus on mutual benefits
      - Length: ${Utils.getSentenceInstruction(details.preferences?.length)}
      - Tone: ${Utils.getToneInstruction(details.preferences?.tone)}
      - Return in this language: ${contexts.language}
      - Highlight unique value proposition
      - Return ONLY the value proposition paragraph, no additional text
      - Do NOT include greetings or sign-offs

      Value Proposition:`;
  }

  static getContext(details: any, contexts: any) {
    return `
      Sender Company: ${details.sender.company.name}
      Receiver Company: ${details.receiver.company.name}
      Context: ${contexts.email || "Professional outreach"}
    `;
  }
}

// Transition to Business
class TransitionToBusiness extends EmailPart {
  static async fromDetailsAndContexts(
    details: any,
    contexts: any,
    openai: OpenAI,
    method: string = "examples"
  ) {
    let result;

    switch (method) {
      case "finetuned":
        result = await this.getFinetuned(details, contexts, openai);
        break;
      case "only_prompt":
        result = await this.getUsingOnlyPrompt(details, contexts, openai);
        break;
      case "examples":
      default:
        result = await this.getWithExamples(details, contexts, openai);
        break;
    }

    return result.cleanContent();
  }

  static async getFinetuned(details: any, contexts: any, openai: OpenAI) {
    const prompt = await this.buildPrompt(details, contexts);

    const completion = await createOpenAICompletion(openai, {
      model: CONFIG.MODELS.FINETUNED_TTB,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.BALANCED,
      max_tokens: 200,
    });

    const content = completion || "";
    const parsed = this.parseFinetunedResponse(content);

    return new TransitionToBusiness(parsed.transition_to_business, {
      explanation: parsed.explanation,
      context: this.getContext(details, contexts),
      language: details.language,
    });
  }

  static async getUsingOnlyPrompt(details: any, contexts: any, openai: OpenAI) {
    const prompt = await this.buildPrompt(details, contexts);

    const completion = await createOpenAICompletion(openai, {
      model: CONFIG.MODELS.GPT4,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.CONSISTENT,
      max_tokens: 200,
    });

    return new TransitionToBusiness(completion || "", {
      context: this.getContext(details, contexts),
      language: details.language,
    });
  }

  static async getWithExamples(details: any, contexts: any, openai: OpenAI) {
    const context = await this.getContext(details, contexts);
    const systemPrompt = await this.getSystemPrompt(
      details.language,
      details.preferences
    );

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: context },
    ];

    const completion = await createOpenAICompletion(openai, {
      model: CONFIG.MODELS.GPT4,
      messages: messages,
      temperature: Utils.getTemperatureForTone(details.preferences?.tone),
      max_tokens: Utils.getMaxTokens(details.preferences?.length, 200),
    });

    return new TransitionToBusiness(completion || "", {
      context,
      language: details.language,
    });
  }

  static parseFinetunedResponse(response: string) {
    const regex = /explanation:\s*(.*?)\s+transition_to_business:\s*(.*)/s;
    const match = response.match(regex);

    if (match) {
      return {
        explanation: match[1].trim(),
        transition_to_business: match[2].trim(),
      };
    }

    return {
      explanation: "",
      transition_to_business: response,
    };
  }

  static buildPrompt(details: any, contexts: any) {
    return this.buildPromptAsync(details, contexts);
  }

  static async buildPromptAsync(details: any, contexts: any) {
    const context = await this.getContext(details, contexts);
    const examples = await this.getExamples(details.language);
    const systemPrompt = await this.getSystemPrompt(details.language);
    return `${context}\n\n${examples}\n\n${systemPrompt}`;
  }

  static async getContext(details: any, contexts: any) {
    const tmpl = PROMPTS.ttb.context;
    return renderTemplate(tmpl, {
      receiver_company_facts_and_figures:
        details.receiver.company.facts_and_figures || "",
      sender_and_receiver_details: details.sender_receiver_yaml || "",
      other_parts_of_email: contexts.email || "",
      clients_and_partners: contexts?.similarities?.company?.similarity || "",
      problems_solutions: contexts?.problem_solution?.best_match?.content || "",
    });
  }

  static async getExamples(language: string = "en") {
    return PROMPTS.ttb.examples;
  }

  static async getSystemPrompt(language: string = "en", preferences?: any) {
    let raw =
      PROMPTS.ttb.system[language as keyof typeof PROMPTS.ttb.system] ||
      PROMPTS.ttb.system.en;
    raw += `\n\n## Additional Constraints:\n- ${Utils.getToneInstruction(
      preferences?.tone
    )}.\n- Length: ${Utils.getSentenceInstruction(
      preferences?.length
    )}.\n- Tone: ${Utils.getToneInstruction(preferences?.tone)}
    .\n- Return in this language: ${language}
    .\n- Do not use any greetings in this section, just the main content.
    .\n- Do not use any sign-offs in this section, just the main content.`;
    return renderTemplate(raw, { current_day: Utils.getCurrentDay() });
  }
}

// Objection Handling
class ObjectionHandling extends EmailPart {
  static async fromDetailsAndContexts(
    details: any,
    contexts: any,
    openai: OpenAI
  ) {
    const prompt = await this.buildPrompt(details, contexts);

    const completion = await createOpenAICompletion(openai, {
      model: CONFIG.MODELS.GPT4,
      messages: [{ role: "user", content: prompt }],
      temperature: Utils.getTemperatureForTone(details.preferences?.tone),
      max_tokens: Utils.getMaxTokens(details.preferences?.length, 200),
    });

    return new ObjectionHandling(completion || "", {
      context: this.getContext(details, contexts),
      language: details.language,
    }).cleanContent();
  }

  static async buildPrompt(details: any, contexts: any) {
    const context = await this.getContext(details, contexts);
    const examples = await this.getExamples(details.language);
    const systemPrompt = await this.getSystemPrompt(
      details.language,
      details.preferences
    );
    return `${context}\n\n${examples}\n\n${systemPrompt}`;
  }

  static async getContext(details: any, contexts: any) {
    const tmpl = PROMPTS.objection.context;
    return renderTemplate(tmpl, {
      sender_company_details: details.sender.company.details || "",
      receiver_commpany_details: details.receiver.company.details || "",
      sender_and_receiver_details: details.sender_receiver_yaml || "",
      other_parts_of_email: contexts.email || "",
      clients_and_partners: contexts?.similarities?.company?.similarity || "",
    });
  }

  static async getExamples(language: string = "en") {
    return PROMPTS.objection.examples;
  }

  static async getSystemPrompt(language: string = "en", preferences?: any) {
    let raw =
      PROMPTS.objection.system[
        language as keyof typeof PROMPTS.objection.system
      ] || PROMPTS.objection.system.en;
    raw += `\n\n## Additional Constraints:\n- ${Utils.getToneInstruction(
      preferences?.tone
    )}.\n- Length: ${Utils.getSentenceInstruction(
      preferences?.length
    )}.\n- Tone: ${Utils.getToneInstruction(preferences?.tone)}
    .\n- Return in this language: ${language}
    `;
    return renderTemplate(raw, { current_day: Utils.getCurrentDay() });
  }
}

// Call to Action
class CallToAction extends EmailPart {
  static async fromDetailsAndContexts(
    details: any,
    contexts: any,
    openai: OpenAI
  ) {
    const prompt = await this.buildPrompt(details, contexts);

    const completion = await createOpenAICompletion(openai, {
      model: CONFIG.MODELS.GPT4,
      messages: [{ role: "user", content: prompt }],
      temperature: Utils.getTemperatureForTone(details.preferences?.tone),
      max_tokens: Utils.getMaxTokens(details.preferences?.length, 200),
    });

    return new CallToAction(completion || "", {
      context: this.getContext(details, contexts),
      language: details.language,
    }).cleanContent();
  }

  static async buildPrompt(details: any, contexts: any) {
    const context = await this.getContext(details, contexts);
    const examples = await this.getExamples(details.language);
    const systemPrompt = await this.getSystemPrompt(
      details.language,
      details.preferences
    );
    return `${context}\n\n${examples}\n\n${systemPrompt}`;
  }

  static async getContext(details: any, contexts: any) {
    const tmpl = PROMPTS.cta.context;
    const now = new Date();
    const availability = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return renderTemplate(tmpl, {
      sender_and_receiver_details: details.sender_receiver_yaml || "",
      sender_availability: details.sender?.availability || availability,
      other_parts_of_email: contexts.email || "",
    });
  }

  static async getExamples(language: string = "en") {
    return PROMPTS.cta.examples;
  }

  static async getSystemPrompt(language: string = "en", preferences?: any) {
    let raw =
      PROMPTS.cta.system[language as keyof typeof PROMPTS.cta.system] ||
      PROMPTS.cta.system.en;
    raw += `\n\n## Additional Constraints:\n- ${Utils.getToneInstruction(
      preferences?.tone
    )}.\n- Length: ${Utils.getSentenceInstruction(
      preferences?.length
    )}.\n- Tone: ${Utils.getToneInstruction(preferences?.tone)}
    .\n- Return in this language: ${language}
    `;
    return renderTemplate(raw, { current_day: Utils.getCurrentDay() });
  }
}

// Main Email1 Class
class Email1 {
  subject: Subject;
  body: EmailPart[];
  language: string;
  contexts: any;

  constructor(subject: Subject, body: EmailPart[], options: any = {}) {
    this.subject = subject;
    this.body = body;
    this.language = options.language || "en";
    this.contexts = options.contexts || {};
  }

  static async generateAll(details: any, contexts: any, openai: OpenAI) {
    try {
      const { subject, body } = await this.getSubjectAndBody(
        details,
        contexts,
        openai
      );

      return new Email1(subject, body, {
        language: details.language,
        contexts,
      });
    } catch (error) {
      console.error("Error generating email:", error);
      throw error;
    }
  }

  static async getSubjectAndBody(details: any, contexts: any, openai: OpenAI) {
    // Stage 1: Generate initial parts (HPEF + VP) in parallel
    const [hpef, vp] = await Promise.all([
      HPEF.fromDetails(details, openai),
      ValueProposition.fromDetailsAndContexts(details, { ...contexts }, openai),
    ]);

    // Update context with initial parts for conditioning the final parts
    contexts.email = `Hyper Personalized Engagement Framework (First paragraph that builds a connection with the receiver): ${hpef.content}\n\nValue Proposition (This paragraph states the benefits of the sender company's solution): ${vp.content}`;

    // Stage 2: Generate final parts (Subject, TTB, Objection, CTA) in parallel using updated context
    const [subject, ttb, objection, cta] = await Promise.all([
      Subject.fromDetailsAndContexts(details, contexts, openai),
      TransitionToBusiness.fromDetailsAndContexts(
        details,
        contexts,
        openai,
        "examples"
      ),
      ObjectionHandling.fromDetailsAndContexts(details, contexts, openai),
      CallToAction.fromDetailsAndContexts(details, contexts, openai),
    ]);

    // Clean up any potential duplication or unwanted content
    // Remove HPEF duplication from TTB only if it appears at the very start to avoid mid-sentence cuts
    const ttbBeforeDedup = ttb.content;
    const hpefText = hpef.content;
    if (ttbBeforeDedup.trim().startsWith(hpefText.trim())) {
      ttb.content = ttbBeforeDedup.slice(hpefText.length).trim();
      console.log("Removed leading HPEF duplication from TTB");
    }

    const cleanHPEF = hpef.content
      .replace(/Subject:.*?(?=\n|Hi|Dear|Hello|Hey|$)/gi, "")
      .replace(/^(Hi|Dear|Hello|Hey)\s+[^,]+,\s*/gi, "")
      .replace(/^(Hi|Dear|Hello|Hey)\s+[^,\n]+[,\n]/gi, "")
      .replace(
        /(^|\n)\s*(I\s+hope\s+you'?re\s+doing\s+well[^\n]*)(?=\n|$)/gi,
        "$1"
      )
      .replace(/(^|\n)\s*(Hope\s+you'?re\s+doing\s+well[^\n]*)(?=\n|$)/gi, "$1")
      .trim();
    console.log("ttb content", ttb.content);
    const cleanTTB = ttb.content
      // Remove a prefixed Subject line only at the start
      .replace(/^\s*Subject:.*?(\r?\n|$)/i, "")
      // Remove greeting line only at the start (e.g., "Hi John, ")
      .replace(/^\s*(Hi|Dear|Hello|Hey)\s+[^,]+,\s*/i, "")
      // Remove just the generic well-wish phrase at the start, not the entire line
      .replace(/^\s*(I\s*hope\s*you'?re\s*(doing\s*well|well)[,.\s]*)/i, "")
      .replace(/^\s*(Hope\s*you'?re\s*(doing\s*well|well)[,.\s]*)/i, "")
      // Remove stray leading punctuation (e.g., leading !, ., commas, dashes)
      .replace(/^\s*[!.,;:\-–—•·]+\s*/, "")
      .trim();
    const safeTTB = cleanTTB.length > 0 ? cleanTTB : ttb.content.trim();
    const cleanVP = vp.content
      .replace(/Subject:.*?(?=\n|Hi|Dear|Hello|Hey|$)/gi, "")
      .replace(/^(Hi|Dear|Hello|Hey)\s+[^,]+,\s*/gi, "")
      .replace(/^(Hi|Dear|Hello|Hey)\s+[^,\n]+[,\n]/gi, "")
      .replace(
        /(^|\n)\s*(I\s+hope\s+you'?re\s+doing\s+well[^\n]*)(?=\n|$)/gi,
        "$1"
      )
      .replace(/(^|\n)\s*(Hope\s+you'?re\s+doing\s+well[^\n]*)(?=\n|$)/gi, "$1")
      .trim();
    const cleanObjection = objection.content
      .replace(/Subject:.*?(?=\n|Hi|Dear|Hello|Hey|$)/gi, "")
      .replace(/^(Hi|Dear|Hello|Hey)\s+[^,]+,\s*/gi, "")
      .replace(/^(Hi|Dear|Hello|Hey)\s+[^,\n]+[,\n]/gi, "")
      .replace(
        /(^|\n)\s*(I\s+hope\s+you'?re\s+doing\s+well[^\n]*)(?=\n|$)/gi,
        "$1"
      )
      .replace(/(^|\n)\s*(Hope\s+you'?re\s+doing\s+well[^\n]*)(?=\n|$)/gi, "$1")
      .trim();
    const cleanCTA = cta.content
      .replace(/Subject:.*?(?=\n|Hi|Dear|Hello|Hey|$)/gi, "")
      .replace(/^(Hi|Dear|Hello|Hey)\s+[^,]+,\s*/gi, "")
      .replace(/^(Hi|Dear|Hello|Hey)\s+[^,\n]+[,\n]/gi, "")
      .replace(
        /(^|\n)\s*(I\s+hope\s+you'?re\s+doing\s+well[^\n]*)(?=\n|$)/gi,
        "$1"
      )
      .replace(/(^|\n)\s*(Hope\s+you'?re\s+doing\s+well[^\n]*)(?=\n|$)/gi, "$1")
      .trim();

    // Update the components with cleaned content
    const senderName = details.sender?.person?.name || "";
    const companyName = details.sender?.company?.name || "";
    hpef.content = Utils.stripSignOffs(cleanHPEF, senderName, companyName);
    console.log("cleanTTB", cleanTTB);
    console.log("safeTTB (post-fallback)", safeTTB);
    ttb.content = Utils.stripSignOffs(safeTTB, senderName, companyName);
    console.log("stripped ttb", ttb.content);
    vp.content = Utils.stripSignOffs(cleanVP, senderName, companyName);
    objection.content = Utils.stripSignOffs(
      cleanObjection,
      senderName,
      companyName
    );
    cta.content = Utils.stripSignOffs(cleanCTA, senderName, companyName);

    const body: EmailPart[] = [hpef, ttb, vp, objection, cta];

    return { subject, body };
  }

  toText() {
    const bodyText = this.body.map((part) => part.toText()).join("\n\n");
    return `Subject: ${this.subject.toText()}\n\n${bodyText}`;
  }

  toMarkdown() {
    const bodyMarkdown = this.body
      .map((part) => part.toMarkdown())
      .join("\n\n");
    return `# ${this.subject.toText()}\n\n${bodyMarkdown}`;
  }

  toJSON() {
    return {
      subject: this.subject.toText(),
      body: this.body.map((part) => ({
        type: part.constructor.name,
        content: part.content,
      })),
      language: this.language,
    };
  }
}

const getUserId = async (req: Request, supabase: any) => {
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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const userId = await getUserId(req, supabase);
    const {
      campaign_id,
      lead,
      emailPreference: { toneOption, lengthOption, emailTypeOption },
    } = await req.json();

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

    const { step_1_result } = progressData;
    const { language } = step_1_result;

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
    });

    const {
      step_5_result: {
        linkedin_profile: { full_name: sender_name },
      },
    } = progressData;

    // Transform lead data into receiver_details format
    const receiver_details = {
      person: {
        name: lead.full_name || `${lead.first_name} ${lead.last_name}`,
        designation: lead.headline || "Business Professional",
        facts: `${lead.summary || ""} ${lead.headline || ""} ${
          lead.jobs?.map((job: any) => job.job_description).join(" ") || ""
        } ${
          lead.insights?.personInsights?.awards
            ?.map((award: any) => award.description)
            .join(" ") || ""
        } ${
          lead.insights?.personInsights?.relevantInsights
            ?.map((insight: any) => insight.description)
            .join(" ") || ""
        } ${
          lead.insights?.personInsights?.onlineMentions
            ?.map((mention: any) => mention.summary)
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
              ?.map((insight: any) => insight.description)
              .join(" ") || ""
          }
          ${
            lead.insights?.businessInsights?.whyNow
              ?.map((why: any) => why.why_now)
              .join(" ") || ""
          }
          ${
            lead.insights?.businessInsights?.commonalities
              ?.map((common: any) => common.description)
              .join(" ") || ""
          }`.trim(),
      },
    };

    // Transform campaign/progress data into sender_details format
    const {
      step_2_result: { company_name, summary, points_of_interest },
      step_5_result: { linkedin_profile },
    } = progressData;
    const sender_details = {
      person: {
        name: sender_name || "Your Name",
        designation: linkedin_profile.headline || "Business Development",
        facts: linkedin_profile.summary || "",
      },
      company: {
        name: company_name || "",
        details: summary || "",
        facts_and_figures: points_of_interest || "",
      },
      availability:
        progressData.availability ||
        "Available for meetings Monday-Friday, 9 AM - 5 PM EST",
    };

    // Prepare details and contexts for the new email generation system
    const details = {
      sender: sender_details,
      receiver: receiver_details,
      language: language || "en",
      sender_receiver_yaml: JSON.stringify({
        sender: sender_details,
        receiver: receiver_details,
      }),
    };

    const contexts = {
      email: `Professional outreach from ${sender_details.person.name} at ${sender_details.company.name} to ${receiver_details.person.name} at ${receiver_details.company.name}`,
      problem_solution: {
        best_match: {
          content:
            "Business optimization and growth through data analytics and transformation solutions",
        },
      },
      similarities: {
        company: {
          similarity: "Business partnerships and growth opportunities",
        },
      },
      language
    };

    // Generate email using the new structured approach
    // Map email preferences
    const preferences = Utils.getPreferences(
      toneOption,
      lengthOption,
      emailTypeOption ||
        (typeof emailType !== "undefined" ? emailType : undefined)
    );
    (details as any).preferences = preferences;

    const email = await Email1.generateAll(details, contexts, openai);

    // Format the response to match the expected structure
    const greeting = Utils.getGreetingForTone(
      preferences.tone,
      receiver_details.person.name
    );
    const bodyParts = email.body.map((part) => part.toText());
    const closing = `${Utils.getClosingForTone(preferences.tone)}\n${
      sender_details.person.name
    }\n${sender_details.person.designation}\n${sender_details.company.name}`;

    const fullEmail = `${greeting}\n\n${bodyParts.join("\n\n")}\n\n${closing}`;

    // Extract individual components
    const hpef = email.body[0]; // HPEF is first
    const transitionToBusiness = email.body[1]; // TTB is second
    const valueProposition = email.body[2]; // VP is third
    const objectionHandling = email.body[3]; // Objection is fourth
    const callToAction = email.body[4]; // CTA is fifth

    const response = {
      subject: email.subject.toText(),
      full_email: fullEmail,
      components: {
        hpef: hpef.toText(),
        transition_to_business: transitionToBusiness.toText(),
        value_proposition: valueProposition.toText(),
        objection_handling: objectionHandling.toText(),
        call_to_action: callToAction.toText(),
      },
    };

    return new Response(
      JSON.stringify({
        message: "Successfully generated email",
        data: response,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
