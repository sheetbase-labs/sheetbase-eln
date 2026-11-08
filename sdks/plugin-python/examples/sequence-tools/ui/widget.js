"use strict";(()=>{var n=t=>t.replace(/\s+/g,"").toUpperCase();async function a(t){let r=await fetch("/operations/analyse",{method:"POST",body:JSON.stringify({sequence:t})}),o=await r.json();if(!r.ok)throw new Error(o.error??"That could not be analysed.");return o}var s=()=>document.getElementById("app");var e=s();e.innerHTML=`
  <div class="col">
    <input id="seq" type="text" spellcheck="false" placeholder="Paste a sequence" aria-label="Sequence" />
    <div id="out" class="stats muted">GC content appears here.</div>
    <div><a id="more" href="#" class="muted">Open the library</a></div>
  </div>`;var i=e.querySelector("#seq"),l=e.querySelector("#out");i.addEventListener("change",async()=>{let t=n(i.value);if(t)try{let r=await a(t);l.textContent=`${r.length} bases \xB7 ${r.gc}% GC`}catch(r){l.textContent=r.message}});e.querySelector("#more").addEventListener("click",t=>{t.preventDefault(),sheetbase.navigate("/plugins/sequence-tools/library")});})();
