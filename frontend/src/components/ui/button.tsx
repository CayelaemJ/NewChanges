import * as React from "react";
import {cn} from "../../lib/utils";
export function Button({className,variant="default",size="default",...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{variant?:"default"|"outline"|"ghost";size?:"default"|"sm"}) {
  const v={default:"bg-[var(--brand-ink-strong)] text-white hover:bg-[var(--brand-focus)]",outline:"border border-slate-300 bg-white text-slate-800 hover:border-[var(--brand-accent)] hover:bg-slate-50",ghost:"text-slate-700 hover:bg-slate-100"};
  const s={default:"h-10 px-4",sm:"h-9 px-3 text-xs"};
  return <button className={cn("inline-flex items-center justify-center rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-focus)] disabled:pointer-events-none disabled:opacity-50",v[variant],s[size],className)} {...props}/>;
}
