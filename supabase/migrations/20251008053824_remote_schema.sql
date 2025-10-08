

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."append_step_10_result"("p_campaign_progress_id" "uuid", "p_job_result" "jsonb", "p_latest_step" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update campaign_progress
  set
    step_10_result = coalesce(step_10_result, '[]'::jsonb) || to_jsonb(p_job_result),
    latest_step = p_latest_step
  where id = p_campaign_progress_id;
end;
$$;


ALTER FUNCTION "public"."append_step_10_result"("p_campaign_progress_id" "uuid", "p_job_result" "jsonb", "p_latest_step" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.user_details (user_id)
  values (new.id);
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."campaign_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "latest_step" integer,
    "status" "text",
    "step_2_result" "jsonb",
    "step_3_result" "jsonb",
    "step_4_result" "jsonb",
    "step_1_result" "jsonb",
    "step_5_result" "jsonb",
    "step_6_result" "jsonb",
    "step_7_result" "jsonb",
    "step_8_result" "jsonb",
    "step_9_result" "jsonb",
    "step_10_result" "jsonb"
);


ALTER TABLE "public"."campaign_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "progress_id" "uuid",
    "language" "text",
    "company_name" "text",
    "company_website" "text"
);


ALTER TABLE "public"."campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies_old" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "website_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."companies_old" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_insights_old" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "company_insights_type_check" CHECK (("type" = ANY (ARRAY['usp'::"text", 'benefit'::"text", 'problem'::"text"])))
);


ALTER TABLE "public"."company_insights_old" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_verifications_old" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "company_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "email_domain" "text" NOT NULL,
    "submitted_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."company_verifications_old" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "campaign_id" "uuid",
    "status" "text" DEFAULT 'queued'::"text",
    "progress_data" "jsonb",
    "job_name" "text",
    "job_step" integer,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "retries" integer
);


ALTER TABLE "public"."jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."target_audiences_old" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "industry" "text" NOT NULL,
    "role" "text" NOT NULL,
    "reasoning" "text",
    "metrics" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."target_audiences_old" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_details" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "company_name" "text",
    "company_website" "text"
);


ALTER TABLE "public"."user_details" OWNER TO "postgres";


ALTER TABLE "public"."user_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."user_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."campaign_progress"
    ADD CONSTRAINT "campaign_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies_old"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_insights_old"
    ADD CONSTRAINT "company_insights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_verifications_old"
    ADD CONSTRAINT "company_verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."target_audiences_old"
    ADD CONSTRAINT "target_audiences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_details"
    ADD CONSTRAINT "user_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_details"
    ADD CONSTRAINT "user_details_user_id_key" UNIQUE ("user_id");



CREATE OR REPLACE TRIGGER "update_target_audiences_updated_at" BEFORE UPDATE ON "public"."target_audiences_old" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_timestamp" BEFORE UPDATE ON "public"."jobs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_progress_id_fkey" FOREIGN KEY ("progress_id") REFERENCES "public"."campaign_progress"("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_details"("user_id");



ALTER TABLE ONLY "public"."company_insights_old"
    ADD CONSTRAINT "company_insights_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies_old"("id");



ALTER TABLE ONLY "public"."company_verifications_old"
    ADD CONSTRAINT "company_verifications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies_old"("id");



ALTER TABLE ONLY "public"."company_verifications_old"
    ADD CONSTRAINT "company_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id");



ALTER TABLE ONLY "public"."target_audiences_old"
    ADD CONSTRAINT "target_audiences_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies_old"("id");



ALTER TABLE ONLY "public"."user_details"
    ADD CONSTRAINT "user_details_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



CREATE POLICY "Allow all authenticated users to delete insights" ON "public"."company_insights_old" FOR DELETE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow all authenticated users to insert companies" ON "public"."companies_old" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow all authenticated users to insert insights" ON "public"."company_insights_old" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow all authenticated users to read companies" ON "public"."companies_old" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow all authenticated users to read insights" ON "public"."company_insights_old" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow all authenticated users to update and delete companies" ON "public"."companies_old" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow all authenticated users to update insights" ON "public"."company_insights_old" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow anonymous users to insert companies" ON "public"."companies_old" FOR INSERT WITH CHECK (("auth"."role"() = 'anon'::"text"));



CREATE POLICY "Allow anonymous users to select companies" ON "public"."companies_old" FOR SELECT USING (true);



CREATE POLICY "Allow authenticated users to delete companies" ON "public"."companies_old" FOR DELETE USING (true);



CREATE POLICY "Allow authenticated users to insert companies" ON "public"."companies_old" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow authenticated users to select companies" ON "public"."companies_old" FOR SELECT USING (true);



CREATE POLICY "Allow authenticated users to update companies" ON "public"."companies_old" FOR UPDATE USING (true);



CREATE POLICY "Allow deletes from company_insights" ON "public"."company_insights_old" FOR DELETE USING (true);



CREATE POLICY "Allow inserts to company_insights" ON "public"."company_insights_old" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow selects from company_insights" ON "public"."company_insights_old" FOR SELECT USING (true);



CREATE POLICY "Allow updates to company_insights" ON "public"."company_insights_old" FOR UPDATE USING (true);



CREATE POLICY "Companies are viewable by all users" ON "public"."companies_old" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can create target audiences for their companies" ON "public"."target_audiences_old" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."companies_old" "c"
  WHERE ("c"."id" = "target_audiences_old"."company_id"))));



CREATE POLICY "Users can insert their own verifications" ON "public"."company_verifications_old" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their company insights" ON "public"."company_insights_old" USING ((EXISTS ( SELECT 1
   FROM "public"."company_verifications_old" "cv"
  WHERE (("cv"."company_id" = "company_insights_old"."company_id") AND ("cv"."user_id" = "auth"."uid"()) AND ("cv"."status" = 'confirmed'::"text")))));



CREATE POLICY "Users can update their own verifications" ON "public"."company_verifications_old" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view target audiences for their companies" ON "public"."target_audiences_old" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."companies_old" "c"
  WHERE ("c"."id" = "target_audiences_old"."company_id"))));



CREATE POLICY "Users can view their company insights" ON "public"."company_insights_old" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."company_verifications_old" "cv"
  WHERE (("cv"."company_id" = "company_insights_old"."company_id") AND ("cv"."user_id" = "auth"."uid"()) AND ("cv"."status" = 'confirmed'::"text")))));



CREATE POLICY "Users can view their own verifications" ON "public"."company_verifications_old" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."campaign_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."companies_old" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_insights_old" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_verifications_old" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."target_audiences_old" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_details" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";








GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
































































































































































































GRANT ALL ON FUNCTION "public"."append_step_10_result"("p_campaign_progress_id" "uuid", "p_job_result" "jsonb", "p_latest_step" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."append_step_10_result"("p_campaign_progress_id" "uuid", "p_job_result" "jsonb", "p_latest_step" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."append_step_10_result"("p_campaign_progress_id" "uuid", "p_job_result" "jsonb", "p_latest_step" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";
























GRANT ALL ON TABLE "public"."campaign_progress" TO "anon";
GRANT ALL ON TABLE "public"."campaign_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_progress" TO "service_role";



GRANT ALL ON TABLE "public"."campaigns" TO "anon";
GRANT ALL ON TABLE "public"."campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."companies_old" TO "anon";
GRANT ALL ON TABLE "public"."companies_old" TO "authenticated";
GRANT ALL ON TABLE "public"."companies_old" TO "service_role";



GRANT ALL ON TABLE "public"."company_insights_old" TO "anon";
GRANT ALL ON TABLE "public"."company_insights_old" TO "authenticated";
GRANT ALL ON TABLE "public"."company_insights_old" TO "service_role";



GRANT ALL ON TABLE "public"."company_verifications_old" TO "anon";
GRANT ALL ON TABLE "public"."company_verifications_old" TO "authenticated";
GRANT ALL ON TABLE "public"."company_verifications_old" TO "service_role";



GRANT ALL ON TABLE "public"."jobs" TO "anon";
GRANT ALL ON TABLE "public"."jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."jobs" TO "service_role";



GRANT ALL ON TABLE "public"."target_audiences_old" TO "anon";
GRANT ALL ON TABLE "public"."target_audiences_old" TO "authenticated";
GRANT ALL ON TABLE "public"."target_audiences_old" TO "service_role";



GRANT ALL ON TABLE "public"."user_details" TO "anon";
GRANT ALL ON TABLE "public"."user_details" TO "authenticated";
GRANT ALL ON TABLE "public"."user_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_details_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






























RESET ALL;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();


