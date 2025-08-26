// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }
  const method = req.method.toUpperCase();

  // Create Supabase client once for all operations
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Authentication logic
    let userId = null;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization header is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        }
      );
    }

    try {
      const token = authHeader.replace("Bearer ", "");
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(token);

      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 401,
          }
        );
      }

      userId = user.id;
    } catch (error) {
      return new Response(JSON.stringify({ error: "Authentication failed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    // Route handling
    switch (method) {
      case "GET":
        try {
          const { data, error } = await supabase
            .from("user_details")
            .select("*")
            .eq("user_id", userId)
            .single();

          if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            });
          }

          return new Response(JSON.stringify({ data }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        } catch (dbError) {
          console.error("Database error:", dbError);
          return new Response(
            JSON.stringify({ error: "Failed to fetch company details" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }

      case "POST":
        const body = await req.json();
        const { company_name, company_website } = body;

        if (!company_name) {
          return new Response(
            JSON.stringify({ error: "company_name is required" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 400,
            }
          );
        }

        try {
          const { data, error } = await supabase
            .from("user_details")
            .upsert(
              {
                user_id: userId,
                company_name,
                company_website,
              },
              {
                onConflict: "user_id",
                ignoreDuplicates: false,
              }
            )
            .select()
            .single();

          if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            });
          }

          const result = {
            message: "Company details saved successfully",
            data,
          };

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        } catch (dbError) {
          console.error("Database error:", dbError);
          return new Response(
            JSON.stringify({ error: "Failed to save company details" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }

      default:
        return new Response(
          JSON.stringify({ error: `Method ${method} not allowed` }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 405,
          }
        );
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  # GET request (retrieve company details for authenticated user)
  curl -i --location --request GET 'http://127.0.0.1:54321/functions/v1/company-details' \
    --header 'Authorization: Bearer YOUR_JWT_TOKEN'

  # POST request (create/update company details)
  # Note: user_id is automatically extracted from JWT token
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/company-details' \
    --header 'Authorization: Bearer YOUR_JWT_TOKEN' \
    --header 'Content-Type: application/json' \
    --data '{"company_name":"Example Corp","company_website":"https://example.com"}'

*/
