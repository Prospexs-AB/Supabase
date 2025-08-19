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

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();
    const MAX_RETRIES = 5;

    // Step 0 jobs: move back to queued and increment retries
    const { data: step0Jobs, error: step0FetchError } = await supabase
      .from("jobs")
      .select("id,retries")
      .eq("job_name", "lead-insights")
      .eq("status", "processing")
      .eq("job_step", 0)
      .lt("updated_at", fiveMinutesAgo);

    if (step0FetchError) throw step0FetchError;

    if (step0Jobs && step0Jobs.length > 0) {
      const step0ToFail = step0Jobs.filter((job: { retries: number | null }) => (job.retries ?? 0) >= MAX_RETRIES);
      const step0ToRetry = step0Jobs.filter((job: { retries: number | null }) => (job.retries ?? 0) < MAX_RETRIES);

      if (step0ToRetry.length > 0) {
        const step0RetryUpdates = step0ToRetry.map((job: { id: string; retries: number | null }) => ({
          id: job.id,
          status: "queued",
          updated_at: nowIso,
          retries: (job.retries ?? 0) + 1,
        }));

        const { error: step0RetryError } = await supabase
          .from("jobs")
          .upsert(step0RetryUpdates);
        if (step0RetryError) throw step0RetryError;
      }

      if (step0ToFail.length > 0) {
        const step0FailUpdates = step0ToFail.map((job: { id: string; retries: number | null }) => ({
          id: job.id,
          status: "failed",
          updated_at: nowIso,
          retries: Math.max(job.retries ?? 0, MAX_RETRIES),
        }));

        const { error: step0FailError } = await supabase
          .from("jobs")
          .upsert(step0FailUpdates);
        if (step0FailError) throw step0FailError;
      }
    }

    // Non-step 0 jobs: move to waiting_for_next_step and increment retries
    const { data: nextStepJobs, error: nextStepFetchError } = await supabase
      .from("jobs")
      .select("id,retries")
      .eq("job_name", "lead-insights")
      .eq("status", "processing")
      .neq("job_step", 0)
      .lt("updated_at", fiveMinutesAgo);

    if (nextStepFetchError) throw nextStepFetchError;

    if (nextStepJobs && nextStepJobs.length > 0) {
      const nextToFail = nextStepJobs.filter((job: { retries: number | null }) => (job.retries ?? 0) >= MAX_RETRIES);
      const nextToRetry = nextStepJobs.filter((job: { retries: number | null }) => (job.retries ?? 0) < MAX_RETRIES);

      if (nextToRetry.length > 0) {
        const nextRetryUpdates = nextToRetry.map((job: { id: string; retries: number | null }) => ({
          id: job.id,
          status: "waiting_for_next_step",
          updated_at: nowIso,
          retries: (job.retries ?? 0) + 1,
        }));

        const { error: nextRetryError } = await supabase
          .from("jobs")
          .upsert(nextRetryUpdates);
        if (nextRetryError) throw nextRetryError;
      }

      if (nextToFail.length > 0) {
        const nextFailUpdates = nextToFail.map((job: { id: string; retries: number | null }) => ({
          id: job.id,
          status: "failed",
          updated_at: nowIso,
          retries: Math.max(job.retries ?? 0, MAX_RETRIES),
        }));

        const { error: nextFailError } = await supabase
          .from("jobs")
          .upsert(nextFailUpdates);
        if (nextFailError) throw nextFailError;
      }
    }

    return new Response(
      JSON.stringify({ message: "Job updated successfully" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/retry-jobs' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
