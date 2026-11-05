import { createElement } from 'react';
export const createFileRoute = (_path: string) => (_options: unknown) => ({ useSearch: () => ({ chat: "chat-a" }) });
export const Link = ({to, children, ...props}: {to: string; children?: React.ReactNode; [key: string]: unknown}) => createElement('a', {...props, href: to}, children);

export const useBlocker = (_options: unknown) => {};
