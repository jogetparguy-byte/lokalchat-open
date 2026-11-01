ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS simulator_tested_at timestamptz,
  ADD COLUMN IF NOT EXISTS checklist_dismissed_session text,
  ADD COLUMN IF NOT EXISTS checklist_celebrated_at timestamptz;
