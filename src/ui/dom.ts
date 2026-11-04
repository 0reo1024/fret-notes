export function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
}
export const $$ = <T extends HTMLElement = HTMLElement>(selector: string): T[] => [...document.querySelectorAll<T>(selector)];
export const inputTarget = (event: Event) => event.target as HTMLInputElement;
