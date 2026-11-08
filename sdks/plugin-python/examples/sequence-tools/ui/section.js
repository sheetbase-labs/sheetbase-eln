"use strict";(()=>{var o=t=>t.replace(/\s+/g,"").toUpperCase();async function a(t){let e=await fetch("/operations/analyse",{method:"POST",body:JSON.stringify({sequence:t})}),n=await e.json();if(!e.ok)throw new Error(n.error??"That could not be analysed.");return n}function s(t){return`${t.length} bases \xB7 ${t.gc}% GC \xB7 A ${t.counts.A} \xB7 C ${t.counts.C} \xB7 G ${t.counts.G} \xB7 T ${t.counts.T}`}var i=()=>document.getElementById("app");var r=i();r.innerHTML=`
  <div class="col">
    <label for="name">Sequence name</label>
    <input id="name" type="text" />
    <label for="seq">Sequence</label>
    <textarea id="seq" rows="4" spellcheck="false"></textarea>
    <button id="go">Summarise</button>
    <div id="note" class="muted"></div>
  </div>`;var c=r.querySelector("#name"),p=r.querySelector("#seq"),l=r.querySelector("#note");r.querySelector("#go").addEventListener("click",async()=>{try{let t=await a(o(p.value));sheetbase.setSection({title:`Sequence summary: ${c.value.trim()||"unnamed"}`,text:s(t)}),l.textContent=""}catch(t){l.innerHTML=`<span class="err">${t.message}</span>`}});})();
