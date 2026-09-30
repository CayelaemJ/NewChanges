import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const html=fs.readFileSync(path.join(root,"public/dashboard.html"),"utf8");
const css=fs.readFileSync(path.join(root,"public/dashboard.css"),"utf8");
const failures=[];
const must=(ok,msg)=>{if(!ok) failures.push(msg);};

must(html.includes('name="viewport"') && html.includes("width=device-width"),"dashboard needs a mobile viewport");
must(html.includes("aria-label="),"dashboard needs labelled interactive and assistive controls");
must(css.includes("focus-visible"),"dashboard needs visible keyboard focus styling");
must(css.includes("prefers-reduced-motion"),"dashboard needs reduced-motion handling");
must(html.includes('type="button"'),"dashboard buttons should declare button type");
must(html.includes('role="dialog"'),"dashboard needs an accessible dialog pattern");
must(css.includes("@media (max-width:640px)") && css.includes("orientation:landscape"),"dashboard needs portrait and landscape mobile handling");
must(css.includes("overflow-wrap:anywhere"),"long labels need safe wrapping");
must(!css.includes("outline: none") || css.includes("focus-visible"),"if native focus outlines are removed, a focus-visible replacement must exist");

if(failures.length){console.error("ACCESSIBILITY REGRESSION CHECK FAILED:"); failures.forEach(x=>console.error(" - "+x)); process.exit(1);}
console.log("Accessibility regression checks passed.");
