CREATE TABLE public.unanswered_questions (
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
CREATE INDEX unanswered_questions_business_idx ON public.unanswered_questions(business_id, status, last_asked_at DESC);

GRANT SELECT ON public.unanswered_questions TO authenticated;
GRANT UPDATE (status, faq_id, resolved_at, updated_at) ON public.unanswered_questions TO authenticated;
GRANT ALL ON public.unanswered_questions TO service_role;
ALTER TABLE public.unanswered_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own unanswered questions" ON public.unanswered_questions
  FOR SELECT TO authenticated USING (business_id = auth.uid());
CREATE POLICY "Owners update own unanswered questions" ON public.unanswered_questions
  FOR UPDATE TO authenticated USING (business_id = auth.uid()) WITH CHECK (business_id = auth.uid());

CREATE TRIGGER unanswered_questions_updated_at BEFORE UPDATE ON public.unanswered_questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.unanswered_question_occurrences (
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
CREATE INDEX uq_occurrences_question_idx ON public.unanswered_question_occurrences(question_id, created_at DESC);
CREATE INDEX uq_occurrences_business_idx ON public.unanswered_question_occurrences(business_id);

GRANT SELECT ON public.unanswered_question_occurrences TO authenticated;
GRANT ALL ON public.unanswered_question_occurrences TO service_role;
ALTER TABLE public.unanswered_question_occurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own unanswered occurrences" ON public.unanswered_question_occurrences
  FOR SELECT TO authenticated USING (business_id = auth.uid());
