import * as React from "react";
import {cn} from "../../lib/utils";
export function Card({className,...props}:React.HTMLAttributes<HTMLDivElement>){return <section className={cn("border border-slate-200 bg-white text-slate-950 shadow-[0_1px_2px_rgba(13,20,27,.04)]",className)} {...props}/>}
export function CardHeader({className,...props}:React.HTMLAttributes<HTMLDivElement>){return <div className={cn("flex flex-col space-y-1.5 border-b border-slate-200 p-5 pb-4",className)} {...props}/>}
export function CardTitle({className,...props}:React.HTMLAttributes<HTMLHeadingElement>){return <h3 className={cn("font-display text-base font-semibold tracking-tight text-slate-900",className)} {...props}/>}
export function CardDescription({className,...props}:React.HTMLAttributes<HTMLParagraphElement>){return <p className={cn("text-xs leading-6 text-slate-600",className)} {...props}/>}
export function CardContent({className,...props}:React.HTMLAttributes<HTMLDivElement>){return <div className={cn("p-5 pt-4",className)} {...props}/>;
}
