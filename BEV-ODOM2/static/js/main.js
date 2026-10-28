/* ==========================================================================
   main.js — 页面通用交互（纯原生 JS，file:// 可直接运行）
     · 移动端导航开合、导航高亮
     · 数据集 pill 标签页：切换视频源/封面
     · 表格标签页
     · BibTeX 一键复制
   ========================================================================== */
"use strict";

/* ----------------------------------------------------- 移动端导航开合 */
(function () {
  const toggle = document.getElementById("navToggle");
  const links = document.getElementById("navlinks");
  if (!toggle || !links) return;
  toggle.addEventListener("click", () => links.classList.toggle("open"));
  links.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => links.classList.remove("open")));
})();

/* ----------------------------------------------- 数据集标签页（视频） */
document.querySelectorAll("[data-tabgroup]").forEach((group) => {
  const video = document.querySelector(group.dataset.vid);
  const base = group.dataset.vidbase;
  const tabs = [...group.querySelectorAll(".tab")];
  tabs.forEach((t) => t.addEventListener("click", () => {
    tabs.forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    const src = `./assets/videos/${base}-${t.dataset.ds}.mp4`;
    const source = video.querySelector("source");
    if (source.getAttribute("src") === src) return;
    source.setAttribute("src", src);
    video.setAttribute("poster", `./assets/videos/${base}-${t.dataset.ds}.jpg`);
    video.load();
    video.play().catch(() => {});
  }));
});

/* ------------------------------------ 折叠块内的视频：展开时播放、收起时暂停 */
document.querySelectorAll("details.more").forEach((d) => {
  const v = d.querySelector("video");
  if (!v) return;
  d.addEventListener("toggle", () => (d.open ? v.play().catch(() => {}) : v.pause()));
});

/* ----------------------------------------------------- 表格标签页 */
(function () {
  const tabs = [...document.querySelectorAll("#table-tabs .tab")];
  tabs.forEach((t) => t.addEventListener("click", () => {
    tabs.forEach((x) => {
      x.setAttribute("aria-selected", String(x === t));
      document.getElementById(x.dataset.panel).classList.toggle("active", x === t);
    });
  }));
})();

/* ----------------------------------------------------- BibTeX 一键复制 */
(function () {
  const btn = document.getElementById("copyBib");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const pre = document.getElementById("bibtex-text");
    const label = btn.querySelector("span");
    try {
      await navigator.clipboard.writeText(pre.innerText);
    } catch {
      const r = document.createRange();
      r.selectNodeContents(pre);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      document.execCommand("copy");
      sel.removeAllRanges();
    }
    btn.classList.add("done");
    label.textContent = "Copied!";
    setTimeout(() => { btn.classList.remove("done"); label.textContent = "Copy"; }, 1800);
  });
})();

/* ------------------------------------------------ 导航高亮当前区块 */
(function () {
  const links = [...document.querySelectorAll(".nav .links a")];
  const map = new Map();
  links.forEach((a) => { const s = document.getElementById(a.getAttribute("href").slice(1)); if (s) map.set(s, a); });
  if (!map.size) return;
  const spy = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { links.forEach((l) => l.classList.remove("active")); map.get(e.target)?.classList.add("active"); }
  }), { rootMargin: "-45% 0px -50% 0px" });
  map.forEach((_, s) => spy.observe(s));
})();
