export function isTemplatePathAllowed(path) {
  return !path.split(/[/\\]/).some(part =>
    ['node_modules', '.git', '.lokalchat', '.supabase', '.temp', '.branches', '.output', 'dist'].includes(part)
    || (part.startsWith('.env') && part !== '.env.example')
    || part.endsWith('.log'));
}
