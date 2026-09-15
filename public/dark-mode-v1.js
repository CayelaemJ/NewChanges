/* Dark-mode state only. No floating toggle and no filter/inversion. */
(function(){
  'use strict';
  var KEY='ef_theme';
  function preferred(){
    try{var s=localStorage.getItem(KEY); if(s==='dark'||s==='light') return s;}catch(_){}
    return (window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';
  }
  function apply(t){document.documentElement.setAttribute('data-theme',t);}
  apply(preferred());
  try{
    var mq=window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change',function(){
      if(!localStorage.getItem(KEY)) apply(mq.matches?'dark':'light');
    });
  }catch(_){}
})();
