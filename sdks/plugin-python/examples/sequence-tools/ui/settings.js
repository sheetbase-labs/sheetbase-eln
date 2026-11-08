"use strict";(()=>{var r=()=>document.getElementById("app");var o=r();o.innerHTML=`
  <div class="col" style="max-width:360px">
    <label for="windows">Windows around the ring</label>
    <select id="windows">
      <option value="24">24</option>
      <option value="48">48</option>
      <option value="96">96</option>
    </select>
    <div class="muted">Kept in this browser, for you.</div>
  </div>`;var t=o.querySelector("#windows");sheetbase.onContext((n,e)=>{t.value=String(e?.windows??48)});t.addEventListener("change",()=>{sheetbase.setState({windows:Number(t.value)}),sheetbase.notify("Saved","success")});})();
