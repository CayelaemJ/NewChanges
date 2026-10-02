import * as React from "react";
import {cn} from "../../lib/utils";
export function Select({label,className,...props}:React.SelectHTMLAttributes<HTMLSelectElement>&{label?:string}){return <label className="grid min-w-0 gap-1.5">{label&&<span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>}<select className={cn("h-10 min-w-[150px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100",className)} {...props}/></label>;}
