import {cn} from "../../lib/utils";
export function Progress({value=0,className}:{value?:number;className?:string}){return <div className={cn("h-2 w-full overflow-hidden rounded-full bg-slate-100",className)}><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-800 transition-all" style={{width:`${Math.max(0,Math.min(100,value))}%`}}/></div>;}
