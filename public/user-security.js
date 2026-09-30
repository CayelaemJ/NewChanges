(function(){
  "use strict";
  const $=window.$ || function(s){return document.querySelector(s);};
  const getJson=window.getJson || async function(url,options){
    const r=await fetch(url,Object.assign({cache:"no-store"},options||{}));
    const d=await r.json().catch(function(){return null;});
    if(r.status===401){location.href="/login";throw new Error("Session expired");}
    if(!r.ok) throw new Error((d&&d.error)||("Request failed ("+r.status+")"));
    return d;
  };
  const esc=window.escHtml || function(v){return String(v==null?"":v).replace(/[&<>"']/g,function(ch){return({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]);});};

  window.SECURITY_SESSIONS=[];
  window.SECURITY_ALERTS=[];
  window.SECURITY_LOGINS=[];
  window.SESSION_SUMMARY=new Map();

  window.formatAge=function(seconds){
    seconds=Math.max(0,Number(seconds)||0);
    const d=Math.floor(seconds/86400),h=Math.floor(seconds%86400/3600),m=Math.floor(seconds%3600/60);
    if(d) return d+"d "+h+"h";
    if(h) return h+"h "+m+"m";
    return m+"m";
  };
  window.timeAgo=function(value){
    if(!value) return "No activity";
    const seconds=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/1000));
    if(seconds<60) return "just now";
    if(seconds<3600) return Math.floor(seconds/60)+"m ago";
    if(seconds<86400) return Math.floor(seconds/3600)+"h ago";
    return Math.floor(seconds/86400)+"d ago";
  };

  async function loadSecurityCenter(){
    try{
      const status=($("#sec-status")&&$("#sec-status").value)||"active";
      const data=await Promise.all([
        getJson("/api/admin/security/overview"),
        getJson("/api/admin/security/sessions?status="+encodeURIComponent(status)+"&limit=100"),
        getJson("/api/admin/security/alerts?status=OPEN&limit=50"),
        getJson("/api/admin/security/logins?limit=80")
      ]);
      const overview=data[0]||{};
      window.SECURITY_SESSIONS=Array.isArray(data[1])?data[1]:[];
      window.SECURITY_ALERTS=Array.isArray(data[2])?data[2]:[];
      window.SECURITY_LOGINS=Array.isArray(data[3])?data[3]:[];
      window.SESSION_SUMMARY=new Map();
      window.SECURITY_SESSIONS.forEach(function(s){
        const prev=window.SESSION_SUMMARY.get(s.user.id)||{count:0,lastSeenAt:null};
        prev.count+=1;
        if(!prev.lastSeenAt || new Date(s.lastSeenAt)>new Date(prev.lastSeenAt)) prev.lastSeenAt=s.lastSeenAt;
        window.SESSION_SUMMARY.set(s.user.id,prev);
      });
      if($("#sec-live")) $("#sec-live").textContent=String(overview.activeSessions||window.SECURITY_SESSIONS.filter(function(s){return s.active;}).length);
      if($("#sec-failed")) $("#sec-failed").textContent=String(overview.failedLogins24h||0);
      if($("#sec-alerts")) $("#sec-alerts").textContent=String(overview.openAlerts||window.SECURITY_ALERTS.length);
      if($("#sec-success")) $("#sec-success").textContent=String(overview.successfulLogins24h||0);
      const state=overview.riskState||"Good";
      if($("#security-state-title")) $("#security-state-title").textContent="Security posture: "+state;
      if($("#security-state-copy")) $("#security-state-copy").textContent=state==="Good"
        ?"No open security alerts and no unusual sign-in volume detected."
        :state==="Watch"
          ?"Sign-in activity needs review. Check failed logins and recent sessions."
          :"One or more security alerts need attention. Review before making access changes.";
      renderSecuritySessions();
      renderSecurityAlerts();
      renderSecurityLogins();
      if(window.renderUsersTable) window.renderUsersTable();
    }catch(error){console.error("[users] security load failed",error);}
  }

  function renderSecuritySessions(){
    const rows=$("#sec-session-rows"); if(!rows) return;
    const q=(($("#sec-search")&&$("#sec-search").value)||"").trim().toLowerCase();
    const filtered=window.SECURITY_SESSIONS.filter(function(s){
      return [s.user.name,s.user.email,s.ipAddress,s.location,s.browser,s.operatingSystem].join(" ").toLowerCase().includes(q);
    });
    if(!filtered.length){rows.innerHTML='<tr><td colspan="6" class="security-empty">No matching sessions.</td></tr>';return;}
    rows.innerHTML=filtered.map(function(s){
      return "<tr>"+
        "<td><b>"+esc(s.user.name)+"</b><div class="meta">"+esc(s.user.email)+"</div></td>"+
        "<td><span class="device">"+esc(s.deviceType)+"</span><div class="meta">"+esc(s.browser)+" · "+esc(s.operatingSystem)+"</div></td>"+
        "<td class="security-location">"+esc(s.location)+"<div class="meta">"+esc(s.ipAddress||"IP unavailable")+"</div></td>"+
        "<td class="muted">"+esc(window.timeAgo(s.lastSeenAt))+"</td>"+
        "<td class="muted">"+esc(window.formatAge(s.durationSeconds))+"</td>"+
        "<td><button class="btn btn-sm" type="button" data-revoke-session=""+esc(s.id)+"" data-user-name=""+esc(s.user.name)+"">Log out</button></td>"+
      "</tr>";
    }).join("");
    rows.querySelectorAll("[data-revoke-session]").forEach(function(btn){
      btn.addEventListener("click",function(){window.revokeSession(btn.getAttribute("data-revoke-session"),btn.getAttribute("data-user-name"));});
    });
  }

  function renderSecurityAlerts(){
    const rows=$("#sec-alert-rows"); if(!rows) return;
    if(!window.SECURITY_ALERTS.length){rows.innerHTML='<tr><td colspan="4" class="security-empty">No open security alerts.</td></tr>';return;}
    rows.innerHTML=window.SECURITY_ALERTS.map(function(a){
      const cls=(a.severity==="CRITICAL"||a.severity==="HIGH")?"off":"pend";
      return "<tr><td><span class="tag "+cls+"">"+esc(a.severity)+"</span></td>"+
        "<td><b>"+esc(a.title)+"</b><div class="meta">"+esc(a.summary)+"</div></td>"+
        "<td class="muted">"+esc(window.timeAgo(a.createdAt))+"</td>"+
        "<td><button class="btn btn-sm" type="button" data-resolve-alert=""+esc(a.id)+"">Resolve</button></td></tr>";
    }).join("");
    rows.querySelectorAll("[data-resolve-alert]").forEach(function(btn){
      btn.addEventListener("click",function(){window.resolveAlert(btn.getAttribute("data-resolve-alert"));});
    });
  }

  function renderSecurityLogins(){
    const rows=$("#sec-login-rows"); if(!rows) return;
    rows.innerHTML=window.SECURITY_LOGINS.map(function(l){
      return "<tr><td class="muted">"+esc(new Date(l.createdAt).toLocaleString())+"</td>"+
        "<td><b>"+esc(l.email)+"</b></td>"+
        "<td>"+(l.success?'<span class="tag live">Success</span>':'<span class="tag off">Failed</span>')+(l.failureReason?'<div class="meta">'+esc(l.failureReason)+'</div>':"")+"</td>"+
        "<td>"+esc(l.deviceType||"Unknown")+"<div class="meta">"+esc(l.browser||"Unknown")+" · "+esc(l.operatingSystem||"Unknown")+"</div></td>"+
        "<td>"+esc([l.city,l.region,l.country].filter(Boolean).join(", ")||"Location unavailable")+"</td>"+
        "<td class="muted">"+esc(l.ipAddress||"Unavailable")+"</td></tr>";
    }).join("")||'<tr><td colspan="6" class="security-empty">No sign-in history yet.</td></tr>';
  }

  window.revokeSession=async function(id,name){
    if(!confirm("Log out "+name+" from this session?")) return;
    const r=await fetch("/api/admin/security/sessions/"+encodeURIComponent(id)+"/revoke",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason:"Revoked by admin from Security and Identity Centre"})});
    const d=await r.json().catch(function(){return {};});
    if(!r.ok){alert(d.error||"Could not revoke the session.");return;}
    await loadSecurityCenter();
  };

  window.resolveAlert=async function(id){
    const r=await fetch("/api/admin/security/alerts/"+encodeURIComponent(id)+"/resolve",{method:"POST"});
    if(!r.ok){alert("Could not resolve the security alert.");return;}
    await loadSecurityCenter();
  };

  window.viewUserSecurity=async function(id){
    const data=await Promise.all([
      getJson("/api/admin/security/sessions?userId="+encodeURIComponent(id)+"&limit=100"),
      getJson("/api/admin/security/logins?userId="+encodeURIComponent(id)+"&limit=100")
    ]);
    const sessions=Array.isArray(data[0])?data[0]:[];
    const logins=Array.isArray(data[1])?data[1]:[];
    const user=(window.USERS||[]).find(function(u){return u.id===id;});
    if(!user) return;
    const back=document.createElement("div");
    back.className="security-drawer-back";
    const liveCount=sessions.filter(function(s){return s.active;}).length;
    const sessionRows=sessions.map(function(s){
      return "<tr><td>"+(s.active?'<span class="tag live">live</span>':'<span class="tag off">ended</span>')+"</td><td>"+esc(s.deviceType)+"<div class="meta">"+esc(s.browser)+" · "+esc(s.operatingSystem)+"</div></td><td>"+esc(s.location)+"<div class="meta">"+esc(s.ipAddress||"")+"</div></td><td>"+esc(new Date(s.createdAt).toLocaleString())+"</td><td>"+esc(window.timeAgo(s.lastSeenAt))+"</td><td>"+(s.active?'<button class="btn btn-sm" type="button" data-drawer-revoke="'+esc(s.id)+'">Log out</button>':"")+"</td></tr>";
    }).join("");
    const loginRows=logins.slice(0,40).map(function(l){
      return "<tr><td>"+esc(new Date(l.createdAt).toLocaleString())+"</td><td>"+(l.success?'<span class="tag live">Success</span>':'<span class="tag off">Failed</span>')+"</td><td>"+esc(l.deviceType||"Unknown")+"<div class="meta">"+esc(l.browser||"")+" · "+esc(l.operatingSystem||"")+"</div></td><td>"+esc([l.city,l.region,l.country].filter(Boolean).join(", ")||"Location unavailable")+"</td><td>"+esc(l.ipAddress||"")+"</td></tr>";
    }).join("");
    back.innerHTML='<div class="security-drawer" role="dialog" aria-modal="true"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:18px"><div><div class="muted">Security profile</div><h2 style="font:600 24px Fraunces,serif;color:var(--brand-primary);margin:2px 0 4px">'+esc(user.name)+'</h2><div class="muted">'+esc(user.email)+'</div></div><button class="btn btn-sm" type="button" data-close-security>Close</button></div><div class="security-detail-grid"><div class="security-detail"><div class="k">Role</div><div class="v">'+esc(String(user.role||"").replace("_"," "))+'</div></div><div class="security-detail"><div class="k">Account</div><div class="v">'+(user.active?"Active":"Disabled")+'</div></div><div class="security-detail"><div class="k">Live sessions</div><div class="v">'+liveCount+'</div></div><div class="security-detail"><div class="k">Last login</div><div class="v">'+(logins[0]?esc(new Date(logins[0].createdAt).toLocaleString()):"No login recorded")+'</div></div></div><h3 style="margin:20px 0 8px;font-size:12px;color:var(--brand-primary)">Sessions</h3><div class="security-table-wrap"><table class="security-table"><thead><tr><th>State</th><th>Device</th><th>Location</th><th>Started</th><th>Last seen</th><th></th></tr></thead><tbody>'+sessionRows+'</tbody></table></div><h3 style="margin:20px 0 8px;font-size:12px;color:var(--brand-primary)">Recent sign-ins</h3><div class="security-table-wrap"><table class="security-table"><thead><tr><th>Time</th><th>Result</th><th>Device</th><th>Location</th><th>IP</th></tr></thead><tbody>'+loginRows+'</tbody></table></div></div>';
    document.body.appendChild(back);
    back.querySelector("[data-close-security]").addEventListener("click",function(){back.remove();});
    back.addEventListener("click",function(e){if(e.target===back) back.remove();});
    back.querySelectorAll("[data-drawer-revoke]").forEach(function(btn){
      btn.addEventListener("click",async function(){await window.revokeSession(btn.getAttribute("data-drawer-revoke"),user.name);back.remove();});
    });
  };

  window.loadSecurityCenter=loadSecurityCenter;
  window.renderSecuritySessions=renderSecuritySessions;
})();