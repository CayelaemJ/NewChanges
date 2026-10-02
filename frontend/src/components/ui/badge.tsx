import * as React from "react";
import {cn} from "../../lib/utils";
export function Badge({className,...props}:React.HTMLAttributes<HTMLSpanElement>){return <span className={cn("inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-violet-700",className)} {...props}/>;}
