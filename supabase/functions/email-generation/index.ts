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
    return text.trim().replace(/\n+/g, "\n").replace(/\s+/g, " ");
  }
}

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
    const prompt = this.buildPrompt(details, contexts);

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODELS.GPT4_MINI,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.CONSISTENT,
      max_tokens: 100,
    });

    return new Subject(completion.choices[0].message.content || "", {
      context: prompt,
      language: details.language,
    });
  }

  static buildPrompt(details: any, contexts: any) {
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
      openai
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

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODELS.GPT4,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.BALANCED,
      max_tokens: 300,
    });

    const refinedStory = await this.rewriteHPEF(
      completion.choices[0].message.content || "",
      details.language,
      openai
    );

    return refinedStory;
  }

  static async rewriteHPEF(
    oldStory: string,
    language: string = "en",
    openai: OpenAI
  ) {
    const prompt = `
Rewrite this email introduction to make it more concise and engaging:

${oldStory}

Requirements:
- Keep it under 3 sentences
- Make it more personal and relevant
- Maintain professional tone
- Focus on building connection

Rewritten version:`;

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODELS.GPT4_MINI,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.CREATIVE,
      max_tokens: 200,
    });

    return {
      content: completion.choices[0].message.content || "",
    };
  }

  static async selectBestStory(
    stories: any[],
    language: string = "en",
    openai: OpenAI
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
- Professional tone
- Relevance to business context

Respond with only the number (1, 2, etc.) of the best option:`;

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODELS.GPT4_MINI,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.CONSISTENT,
      max_tokens: 50,
    });

    const selectedIndex =
      parseInt(
        completion.choices[0].message.content?.match(/\d+/)?.[0] || "1"
      ) - 1;
    const selectedStory = stories[selectedIndex];

    return selectedStory;
  }

  static async getFinetunedHPEF(details: any, openai: OpenAI) {
    const prompt = this.buildFinetunedPrompt(details);

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODELS.FINETUNED_HPEF,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.BALANCED,
      max_tokens: 300,
      n: 3,
    });

    const hpefs = completion.choices
      .map((choice) => choice.message.content)
      .filter((content) => content)
      .map((content) => this.parseFinetunedResponse(content))
      .filter((hpef) => hpef);

    if (hpefs.length === 0) {
      return await this.getStoryLikeHPEF(details, openai);
    }

    const bestHPEF = await this.selectBestStory(
      hpefs,
      details.language,
      openai
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
Sender Context: ${details.sender.person.facts || "Professional in technology"}

Receiver: ${details.receiver.person.name} (${
      details.receiver.person.designation
    }) at ${details.receiver.company.name}
Receiver Context: ${details.receiver.person.facts || "Business professional"}

Company Context: ${
      details.receiver.company.facts_and_figures || "Established company"
    }

Create a story-like introduction that:
- Builds a personal connection
- Shows understanding of their business
- Is relevant and engaging
- Maintains professional tone
- IMPORTANT: Do NOT include any greetings like "Hi", "Dear", or "Hello"
- Return ONLY the introduction paragraph content

Introduction:`;
  }

  static buildFinetunedPrompt(details: any) {
    return `
Generate a hyper-personalized email introduction.

Sender: ${details.sender.person.name} (${
      details.sender.person.designation
    }) at ${details.sender.company.name}
Sender Context: ${details.sender.person.facts || "Professional in technology"}

Receiver: ${details.receiver.person.name} (${
      details.receiver.person.designation
    }) at ${details.receiver.company.name}
Receiver Context: ${details.receiver.person.facts || "Business professional"}

Company Context: ${
      details.receiver.company.facts_and_figures || "Established company"
    }

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

  static calculateCost(usage: any, model: string) {
    const inputCost = usage.prompt_tokens * 0.00001;
    const outputCost = usage.completion_tokens * 0.00003;
    return inputCost + outputCost;
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
    const prompt = this.buildOpenAIPrompt(details, contexts);

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODELS.GPT4_MINI,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.CONSISTENT,
      max_tokens: 300,
    });

    return {
      content: completion.choices[0].message.content || "",
    };
  }

  static buildOpenAIPrompt(details: any, contexts: any) {
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
- Keep it concise (2-3 sentences)
- Maintain professional tone
- Highlight unique value proposition
- Return ONLY the value proposition paragraph, no additional text

Value Proposition:`;
  }

  static getContext(details: any, contexts: any) {
    return `
Sender Company: ${details.sender.company.name}
Receiver Company: ${details.receiver.company.name}
Context: ${contexts.email || "Professional outreach"}
    `;
  }

  static calculateCost(usage: any, model: string) {
    const inputCost = usage.prompt_tokens * 0.00001;
    const outputCost = usage.completion_tokens * 0.00003;
    return inputCost + outputCost;
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
    const prompt = this.buildPrompt(details, contexts);

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODELS.FINETUNED_TTB,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.BALANCED,
      max_tokens: 200,
    });

    const content = completion.choices[0].message.content || "";
    const parsed = this.parseFinetunedResponse(content);

    return new TransitionToBusiness(parsed.transition_to_business, {
      explanation: parsed.explanation,
      context: this.getContext(details, contexts),
      language: details.language,
    });
  }

  static async getUsingOnlyPrompt(details: any, contexts: any, openai: OpenAI) {
    const prompt = this.buildPrompt(details, contexts);

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODELS.GPT4,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.CONSISTENT,
      max_tokens: 200,
    });

    return new TransitionToBusiness(
      completion.choices[0].message.content || "",
      {
        context: this.getContext(details, contexts),
        language: details.language,
      }
    );
  }

  static async getWithExamples(details: any, contexts: any, openai: OpenAI) {
    const context = this.getContext(details, contexts);
    const systemPrompt = this.getSystemPrompt(details.language);

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: context },
    ];

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODELS.GPT4,
      messages: messages,
      temperature: CONFIG.TEMPERATURE.BALANCED,
      max_tokens: 200,
    });

    return new TransitionToBusiness(
      completion.choices[0].message.content || "",
      {
        context,
        language: details.language,
      }
    );
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
    const context = this.getContext(details, contexts);
    const examples = this.getExamples(details.language);
    const systemPrompt = this.getSystemPrompt(details.language);

    return `${context}\n\n${examples}\n\n${systemPrompt}`;
  }

  static getContext(details: any, contexts: any) {
    return `
Receiver Company Facts: ${
      details.receiver.company.facts_and_figures || "Established company"
    }
Sender & Receiver Details: ${
      details.sender_receiver_yaml || "Professional communication"
    }
Email Context: ${contexts.email || "Professional outreach"}
    `;
  }

  static getExamples(language: string = "en") {
    const examples = {
      en: `
Examples of good transitions:
- "Given your company's focus on innovation, I believe our solution could be particularly relevant."
- "I noticed your company's recent expansion, which aligns perfectly with what we offer."
- "Based on your industry position, I think there's a great opportunity for collaboration."
      `,
    };

    return examples[language as keyof typeof examples] || examples.en;
  }

  static getSystemPrompt(language: string = "en") {
    const prompts = {
      en: `You are a professional business communicator. Create a smooth transition paragraph from personal engagement to business discussion. Return ONLY the transition paragraph, no additional text. Today is ${Utils.getCurrentDay()}.`,
      es: `Eres un comunicador empresarial profesional. Crea una transición suave del compromiso personal a la discusión empresarial. Hoy es ${Utils.getCurrentDay()}.`,
    };

    return prompts[language as keyof typeof prompts] || prompts.en;
  }

  static calculateCost(usage: any, model: string) {
    const inputCost = usage.prompt_tokens * 0.00001;
    const outputCost = usage.completion_tokens * 0.00003;
    return inputCost + outputCost;
  }
}

// Objection Handling
class ObjectionHandling extends EmailPart {
  static async fromDetailsAndContexts(
    details: any,
    contexts: any,
    openai: OpenAI
  ) {
    const prompt = this.buildPrompt(details, contexts);

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODELS.GPT4,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.CONSISTENT,
      max_tokens: 200,
    });

    return new ObjectionHandling(completion.choices[0].message.content || "", {
      context: this.getContext(details, contexts),
      language: details.language,
    }).cleanContent();
  }

  static buildPrompt(details: any, contexts: any) {
    const context = this.getContext(details, contexts);
    const examples = this.getExamples(details.language);
    const systemPrompt = this.getSystemPrompt(details.language);

    return `${context}\n\n${examples}\n\n${systemPrompt}`;
  }

  static getContext(details: any, contexts: any) {
    return `
Sender Company Details: ${
      details.sender.company.details || "Technology solutions provider"
    }
Receiver Company Details: ${
      details.receiver.company.details || "Established business"
    }
Sender & Receiver Details: ${
      details.sender_receiver_yaml || "Professional communication"
    }
Email Context: ${contexts.email || "Professional outreach"}
    `;
  }

  static getExamples(language: string = "en") {
    const examples = {
      en: `
        Examples of objection handling:
        - "I understand you may be busy, but this could save you significant time in the long run."
        - "While this might seem like an additional cost, the ROI typically pays for itself within 3 months."
        - "I know you have existing solutions, but our approach offers unique advantages."
      `,
    };

    return examples[language as keyof typeof examples] || examples.en;
  }

  static getSystemPrompt(language: string = "en") {
    const prompts = {
      en: `Address potential objections professionally and persuasively in a single paragraph. Return ONLY the objection handling paragraph, no additional text. Today is ${Utils.getCurrentDay()}.`,
      es: `Aborda las objeciones potenciales de manera profesional y persuasiva. Hoy es ${Utils.getCurrentDay()}.`,
    };

    return prompts[language as keyof typeof prompts] || prompts.en;
  }

  static calculateCost(usage: any, model: string) {
    const inputCost = usage.prompt_tokens * 0.00001;
    const outputCost = usage.completion_tokens * 0.00003;
    return inputCost + outputCost;
  }
}

// Call to Action
class CallToAction extends EmailPart {
  static async fromDetailsAndContexts(
    details: any,
    contexts: any,
    openai: OpenAI
  ) {
    const prompt = this.buildPrompt(details, contexts);

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODELS.GPT4,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.TEMPERATURE.CONSISTENT,
      max_tokens: 200,
    });

    return new CallToAction(completion.choices[0].message.content || "", {
      context: this.getContext(details, contexts),
      language: details.language,
    }).cleanContent();
  }

  static buildPrompt(details: any, contexts: any) {
    const context = this.getContext(details, contexts);
    const examples = this.getExamples(details.language);
    const systemPrompt = this.getSystemPrompt(details.language);

    return `${context}\n\n${examples}\n\n${systemPrompt}`;
  }

  static getContext(details: any, contexts: any) {
    const now = new Date();
    const availability = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    return `
Sender & Receiver Details: ${
      details.sender_receiver_yaml || "Professional communication"
    }
Sender Availability: ${details.sender.availability || availability}
Email Context: ${contexts.email || "Professional outreach"}
    `;
  }

  static getExamples(language: string = "en") {
    const examples = {
      en: `
Examples of effective calls to action:
- "Would you be available for a 15-minute call this week to discuss this further?"
- "I'd love to schedule a brief meeting to explore how we might collaborate."
- "Could we set up a time to discuss this opportunity in more detail?"
      `,
      es: `
Ejemplos de llamadas a la acción efectivas:
- "¿Estaría disponible para una llamada de 15 minutos esta semana para discutir esto más a fondo?"
- "Me encantaría programar una breve reunión para explorar cómo podríamos colaborar."
      `,
    };

    return examples[language as keyof typeof examples] || examples.en;
  }

  static getSystemPrompt(language: string = "en") {
    const prompts = {
      en: `Create a clear, professional call to action paragraph that encourages a specific next step. Return ONLY the call to action paragraph, no additional text. Today is ${Utils.getCurrentDay()}.`,
      es: `Crea una llamada a la acción clara y profesional que fomente un siguiente paso específico. Hoy es ${Utils.getCurrentDay()}.`,
    };

    return prompts[language as keyof typeof prompts] || prompts.en;
  }

  static calculateCost(usage: any, model: string) {
    const inputCost = usage.prompt_tokens * 0.00001;
    const outputCost = usage.completion_tokens * 0.00003;
    return inputCost + outputCost;
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
    // Generate all parts in parallel with clean contexts
    const [subject, hpef, vp, ttb, objection, cta] = await Promise.all([
      Subject.fromDetailsAndContexts(details, { ...contexts }, openai),
      HPEF.fromDetails(details, openai),
      ValueProposition.fromDetailsAndContexts(details, { ...contexts }, openai),
      TransitionToBusiness.fromDetailsAndContexts(
        details,
        { ...contexts },
        openai,
        "examples"
      ),
      ObjectionHandling.fromDetailsAndContexts(
        details,
        { ...contexts },
        openai
      ),
      CallToAction.fromDetailsAndContexts(details, { ...contexts }, openai),
    ]);

    // Clean up any potential duplication or unwanted content
    const cleanHPEF = hpef.content
      .replace(/Subject:.*?(?=\n|Hi|Dear|Hello|$)/gi, "")
      .replace(/^(Hi|Dear|Hello)\s+[^,]+,\s*/gi, "")
      .replace(/^(Hi|Dear|Hello)\s+[^,\n]+[,\n]/gi, "")
      .trim();
    const cleanTTB = ttb.content
      .replace(/Subject:.*?(?=\n|Hi|Dear|Hello|$)/gi, "")
      .replace(/^(Hi|Dear|Hello)\s+[^,]+,\s*/gi, "")
      .replace(/^(Hi|Dear|Hello)\s+[^,\n]+[,\n]/gi, "")
      .trim();
    const cleanVP = vp.content
      .replace(/Subject:.*?(?=\n|Hi|Dear|Hello|$)/gi, "")
      .replace(/^(Hi|Dear|Hello)\s+[^,]+,\s*/gi, "")
      .replace(/^(Hi|Dear|Hello)\s+[^,\n]+[,\n]/gi, "")
      .trim();
    const cleanObjection = objection.content
      .replace(/Subject:.*?(?=\n|Hi|Dear|Hello|$)/gi, "")
      .replace(/^(Hi|Dear|Hello)\s+[^,]+,\s*/gi, "")
      .replace(/^(Hi|Dear|Hello)\s+[^,\n]+[,\n]/gi, "")
      .trim();
    const cleanCTA = cta.content
      .replace(/Subject:.*?(?=\n|Hi|Dear|Hello|$)/gi, "")
      .replace(/^(Hi|Dear|Hello)\s+[^,]+,\s*/gi, "")
      .replace(/^(Hi|Dear|Hello)\s+[^,\n]+[,\n]/gi, "")
      .trim();

    // Update the components with cleaned content
    hpef.content = cleanHPEF;
    ttb.content = cleanTTB;
    vp.content = cleanVP;
    objection.content = cleanObjection;
    cta.content = cleanCTA;

    // Assemble body in the correct order
    const body = [hpef, ttb, vp, objection, cta];

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
    const supabase = createClient(
      "https://lkkwcjhlkxqttcqrcfpm.supabase.co",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxra3djamhsa3hxdHRjcXJjZnBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTMxMzE5OCwiZXhwIjoyMDYwODg5MTk4fQ.e8SijEhKnoa1R8dYzPBeKcgsEjKtXb9_Gd1uYg6AhuA"
    );

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
    const sender_details = {
      person: {
        name: sender_name || "Your Name",
        designation: "Business Development",
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
    };

    // Generate email using the new structured approach
    const email = await Email1.generateAll(details, contexts, openai);

    // Format the response to match the expected structure
    const greeting = `Hi ${receiver_details.person.name},`;
    const bodyParts = email.body.map((part) => part.toText());
    const closing = `Best regards,\n${sender_details.person.name}\n${sender_details.person.designation}\n${sender_details.company.name}`;

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
