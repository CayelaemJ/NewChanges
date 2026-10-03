import * as React from "react";
import {cn} from "../../lib/utils";
export function Badge({className,...props}:React.HTMLAttributes<HTMLSpanElement>){return <span className={cn("inline-flex items-center border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.08em] text-slate-700",className)} {...props}/>}
