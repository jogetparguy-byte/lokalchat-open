-- Bring dashboard schema previously kept only in Drizzle into the canonical
-- Supabase migration chain. This creates no schedules or outbound HTTP calls.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS owner_whatsapp text,
  ADD COLUMN IF NOT EXISTS weekly_report_sent_at timestamptz;

CREATE TABLE IF NOT EXISTS public.internal_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
REVOKE ALL ON public.internal_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.internal_settings TO service_role;
ALTER TABLE public.internal_settings ENABLE ROW LEVEL SECURITY;
-- Two cryptographically random UUIDs avoid requiring pgcrypto solely for
-- token generation. Existing operator-configured tokens remain unchanged.
INSERT INTO public.internal_settings (key, value)
VALUES ('weekly_report_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.unanswered_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question text NOT NULL,
  normalized_tokens text[] NOT NULL DEFAULT '{}',
  embedding vector(1536),
  status text NOT NULL DEFAULT 'unanswered' CHECK (status IN ('unanswered','resolved','dismissed')),
  occurrence_count integer NOT NULL DEFAULT 1,
  failed_after_faq_count integer NOT NULL DEFAULT 0,
  last_failed_after_faq_at timestamptz,
  faq_id bigint REFERENCES public.knowledge_base(id) ON DELETE SET NULL,
  first_asked_at timestamptz NOT NULL DEFAULT now(),
  last_asked_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS unanswered_questions_business_idx
  ON public.unanswered_questions(business_id, status, last_asked_at DESC);
REVOKE ALL ON public.unanswered_questions FROM PUBLIC, anon;
GRANT SELECT ON public.unanswered_questions TO authenticated;
GRANT UPDATE (status, faq_id, resolved_at, updated_at) ON public.unanswered_questions TO authenticated;
GRANT ALL ON public.unanswered_questions TO service_role;
ALTER TABLE public.unanswered_questions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.unanswered_question_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.unanswered_questions(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chat_id uuid REFERENCES public.chats(id) ON DELETE SET NULL,
  question_text text NOT NULL,
  customer_phone text,
  customer_name text,
  failed_after_faq boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uq_occurrences_question_idx
  ON public.unanswered_question_occurrences(question_id, created_at DESC);
CREATE INDEX IF NOT EXISTS uq_occurrences_business_idx
  ON public.unanswered_question_occurrences(business_id);
REVOKE ALL ON public.unanswered_question_occurrences FROM PUBLIC, anon;
GRANT SELECT ON public.unanswered_question_occurrences TO authenticated;
GRANT ALL ON public.unanswered_question_occurrences TO service_role;
ALTER TABLE public.unanswered_question_occurrences ENABLE ROW LEVEL SECURITY;

-- Preserve matching policies/triggers if the old Drizzle migration was run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'unanswered_questions' AND policyname = 'Owners read own unanswered questions') THEN
    CREATE POLICY "Owners read own unanswered questions" ON public.unanswered_questions
      FOR SELECT TO authenticated USING (business_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'unanswered_questions' AND policyname = 'Owners update own unanswered questions') THEN
    CREATE POLICY "Owners update own unanswered questions" ON public.unanswered_questions
      FOR UPDATE TO authenticated USING (business_id = auth.uid()) WITH CHECK (business_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'unanswered_question_occurrences' AND policyname = 'Owners read own unanswered occurrences') THEN
    CREATE POLICY "Owners read own unanswered occurrences" ON public.unanswered_question_occurrences
      FOR SELECT TO authenticated USING (business_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.unanswered_questions'::regclass AND tgname = 'unanswered_questions_updated_at' AND NOT tgisinternal) THEN
    CREATE TRIGGER unanswered_questions_updated_at BEFORE UPDATE ON public.unanswered_questions
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
