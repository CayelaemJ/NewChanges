import {cn} from "../../lib/utils";
export function Progress({value=0,className}:{value?:number;className?:string}){return <div className={cn("h-1.5 w-full overflow-hidden bg-slate-100",className)}><div className="h-full bg-[var(--brand-accent)] transition-all" style={{width:`${Math.max(0,Math.min(100,value))}%`}}/></div>}
