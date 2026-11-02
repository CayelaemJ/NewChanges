"use strict";
(()=>{
 const form=document.getElementById("access-form");
 const input=document.getElementById("staging-password");
 const submit=document.getElementById("submit");
 const message=document.getElementById("message");
 form.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!input.value){message.textContent="Enter the staging password.";return}
  submit.disabled=true;
  message.dataset.error="false";
  message.textContent="Checking staging access…";
  try{
   const response=await fetch("/staging-access",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({password:input.value})
   });
   input.value="";
   const data=await response.json();
   if(!response.ok||data.ok!==true){
    message.dataset.error="true";
    message.textContent=typeof data.error==="string"?data.error:"Staging access was not approved.";
    return;
   }
   message.textContent="Access approved. Opening the login page…";
   window.location.assign("/login");
  }catch{
   message.dataset.error="true";
   message.textContent="Could not reach staging. If Render is sleeping, open /health and try again.";
  }finally{submit.disabled=false}
 });
})();
