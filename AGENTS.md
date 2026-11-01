<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Session metrics (auto-answered, time saved, handoff rate) live in src/lib/metrics.ts; dashboard and weekly report both use it so numbers match.
- Scheduled jobs call /api/public/hooks/* with a token stored in public.internal_settings (service_role only); cron reads it at run time so no secret is in code.

