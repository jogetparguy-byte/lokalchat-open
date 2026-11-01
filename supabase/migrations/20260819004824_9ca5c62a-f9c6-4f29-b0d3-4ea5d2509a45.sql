CREATE TABLE public.handoff_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  ai_reason text,
  ai_suggested_action text,
  insight_generated_at timestamp with time zone
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_events TO authenticated;
GRANT ALL ON public.handoff_events TO service_role;

ALTER TABLE public.handoff_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Businesses can select own handoff events"
  ON public.handoff_events
  FOR SELECT
  TO authenticated
  USING (business_id = auth.uid());

CREATE POLICY "Businesses can insert own handoff events"
  ON public.handoff_events
  FOR INSERT
  TO authenticated
  WITH CHECK (business_id = auth.uid());

CREATE POLICY "Businesses can update own handoff events"
  ON public.handoff_events
  FOR UPDATE
  TO authenticated
  USING (business_id = auth.uid())
  WITH CHECK (business_id = auth.uid());

CREATE POLICY "Businesses can delete own handoff events"
  ON public.handoff_events
  FOR DELETE
  TO authenticated
  USING (business_id = auth.uid());

CREATE INDEX idx_handoff_events_business_id ON public.handoff_events(business_id);
CREATE INDEX idx_handoff_events_chat_id ON public.handoff_events(chat_id);
