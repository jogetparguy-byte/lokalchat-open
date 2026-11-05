export function completions(shell) {
  const flags = '--package-manager --skip-install --setup-local --completions --help --version';
  if (shell === 'bash') return `_create_lokalchat() {
  local current="\${COMP_WORDS[COMP_CWORD]}" previous="\${COMP_WORDS[COMP_CWORD-1]}"
  if [[ "$previous" == --package-manager ]]; then COMPREPLY=( $(compgen -W "npm pnpm" -- "$current") );
  elif [[ "$previous" == --completions ]]; then COMPREPLY=( $(compgen -W "bash zsh fish" -- "$current") );
  elif [[ "$current" == -* ]]; then COMPREPLY=( $(compgen -W "${flags}" -- "$current") );
  else COMPREPLY=( $(compgen -d -- "$current") ); fi
}
complete -F _create_lokalchat create-lokalchat
`;
  if (shell === 'zsh') return `#compdef create-lokalchat
_arguments '--package-manager[Package manager]:manager:(npm pnpm)' '--skip-install[Skip dependencies]' '--setup-local[Prepare local database and start app]' '--completions[Print completions]:shell:(bash zsh fish)' '--help[Show help]' '--version[Show version]' '1:directory:_files -/'
`;
  if (shell === 'fish') return `complete -c create-lokalchat -f
complete -c create-lokalchat -l package-manager -r -a 'npm pnpm'
complete -c create-lokalchat -l skip-install -d 'Skip dependencies'
complete -c create-lokalchat -l setup-local -d 'Prepare local database and start app'
complete -c create-lokalchat -l completions -r -a 'bash zsh fish'
complete -c create-lokalchat -l help -s h
complete -c create-lokalchat -l version -s v
`;
  throw new Error('--completions must be bash, zsh or fish.');
}
