/* ==========================================================================
   explorer.js — 交互式 BEV Explorer（纯原生 JS，无依赖，file:// 可直接运行）
   数据：data/explorer_<key>.js 注入 window.BEVODOM2_EXPLORER[key]（step4_package_site_data.py 生成，切到该片段时才加载）
     · flow_pred / flow_gt：Int16 base64，形状 (pairs, 2, 32, 32)，通道 0 = 列向位移 u，通道 1 = 行向位移 v（单位：格）
     · 视野区域 64x64 格（0.8 m/格）；行 = 前向 x（向下递减），列 = 横向 y（向右递增），与模型 BEV 网格一致
     · near.row0/col0：flow 区域在视野区域中的起点（NCLT 车前、Oxford 车后）
     · sheets：相机图 / LiDAR BEV 的 5x5 图集（assets/explorer/<key>/*_sheet_XX.webp），LiDAR 仅作可视化参考
   性能：整段图集加载完才允许播放；某帧图集未到时沿用最近一帧已加载的画面，不会出现空白。
   ========================================================================== */
"use strict";

(function () {
  const $ = (id) => document.getElementById(id);
  const root = $("ex-root");
  if (!root) return;

  const COLORS = { pred: "#ff7a59", gt: "#5eead4", grid: "rgba(255,255,255,.05)", grid10: "rgba(255,255,255,.13)",
    region: "rgba(255,255,255,.6)", fov: "rgba(255,255,255,.25)", ego: "#ffffff" };
  const VIEW = 64;          // 视野区域边长（格）
  const FPS = 6;            // 播放帧率
  const els = {
    cam: $("ex-cam"), bev: $("ex-bev"), traj: $("ex-traj"), slider: $("ex-slider"), frame: $("ex-frame"),
    play: $("ex-play"), readout: $("ex-readout"), camname: $("ex-camname"), trajsub: $("ex-trajsub"),
    trajnote: $("ex-trajnote"), loading: $("ex-loading"), progbar: $("ex-progbar"), progtxt: $("ex-progtxt"),
    lidar: $("ex-lidar"),
  };
  const state = { c: null, k: 0, flow: "pred", zoom: "near", playing: false, raf: 0, last: 0, cache: {} };

  /* ------------------------------------------------------------ 数据与图集 */
  function decodeFlow(b64, scale) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const i16 = new Int16Array(u8.buffer);
    const out = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) out[i] = i16[i] / scale;
    return out;
  }

  // 按需加载片段数据脚本（每段约 3 MB，避免首屏解析）；file:// 下同样可用
  function loadData(key) {
    const have = () => (window.BEVODOM2_EXPLORER || {})[key];
    if (have()) return Promise.resolve(have());
    return new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = `./data/explorer_${key}.js`;
      sc.onload = () => (have() ? resolve(have()) : reject(new Error("no data")));
      sc.onerror = () => reject(new Error(`failed to load ${sc.src}`));
      document.head.appendChild(sc);
    });
  }

  function prepare(key, d) {
    if (state.cache[key]) return state.cache[key];
    const c = { d, fp: decodeFlow(d.flow_pred, d.flow_scale), fg: decodeFlow(d.flow_gt, d.flow_scale),
      sheets: { img: [], bev: [] }, loaded: 0, total: d.sheets.img.files.length + d.sheets.bev.files.length };
    ["img", "bev"].forEach((kind) => d.sheets[kind].files.forEach((f, i) => {
      const im = new Image();
      im.decoding = "async";
      im.onload = () => {
        c.loaded++;
        c.sheets[kind][i] = im;
        if (state.c === c) { progress(); draw(); }
      };
      im.onerror = () => { c.loaded++; if (state.c === c) progress(); };
      im.src = `./assets/explorer/${key}/${f}`;
    }));
    state.cache[key] = c;
    return c;
  }

  // 帧 i 在图集中的位置；若该图集未加载，回退到最近一帧已加载的帧
  function frameSource(c, kind, i) {
    const s = c.d.sheets, per = s.per;
    for (let j = i; j >= 0; j--) {
      const sheet = c.sheets[kind][Math.floor(j / per)];
      if (sheet) {
        const q = j % per, S = s[kind];
        return { im: sheet, sx: (q % s.cols) * S.w, sy: Math.floor(q / s.cols) * S.h, w: S.w, h: S.h };
      }
    }
    return null;
  }

  function progress() {
    const c = state.c;
    els.progbar.style.width = `${Math.round((100 * c.loaded) / c.total)}%`;
    els.progtxt.textContent = `Loading ${c.d.dataset} clip · ${c.loaded}/${c.total}`;
    // 第一张相机图集与 BEV 图集到位即可交互；整段到齐才允许播放
    els.loading.hidden = Boolean(c.sheets.img[0] && c.sheets.bev[0]);
    els.play.disabled = c.loaded < c.total;
  }

  /* ------------------------------------------------------------ BEV 绘制 */
  // 视窗（视野区域格坐标）：近景 = flow 区域外扩并含自车；全景 = 整个 64x64 视野
  function viewWindow(d) {
    if (state.zoom === "full") return { r0: -2, c0: -2, S: VIEW + 4 };
    const S = 44;
    const c0 = d.near.col0 + 16 - S / 2;
    const r0 = d.near.row0 === 0 ? -6 : VIEW + 6 - S;     // Oxford 自车在第 0 行；NCLT 在第 64 行
    return { r0, c0, S };
  }

  function arrow(ctx, x0, y0, x1, y1, head) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    if (L < 2) return;
    const ux = dx / L, uy = dy / L, h = Math.min(head, L * 0.5);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - h * (ux - 0.5 * uy), y1 - h * (uy + 0.5 * ux));
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - h * (ux + 0.5 * uy), y1 - h * (uy - 0.5 * ux));
  }

  // 画布文字：带半透明深色底，避免被箭头或点云压住
  function label(ctx, text, x, y, color) {
    const m = ctx.measureText(text), h = 24;
    const top = ctx.textBaseline === "bottom" ? y - h + 3 : y - 3;
    ctx.fillStyle = "rgba(11,15,20,.72)";
    ctx.fillRect(x - 5, top, m.width + 10, h);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function errColor(e) {
    // 0 → 1 格：青 → 黄 → 红
    const t = Math.max(0, Math.min(1, e));
    const r = Math.round(t < 0.5 ? 40 + 400 * t : 240);
    const g = Math.round(t < 0.5 ? 200 : 200 - 300 * (t - 0.5));
    return `rgba(${r},${g},60,0.78)`;
  }

  function drawBEV(c, k) {
    const d = c.d;
    const cv = els.bev, ctx = cv.getContext("2d");
    const W = cv.width, win = viewWindow(d), s = W / win.S;
    const X = (col) => (col - win.c0) * s, Y = (row) => (row - win.r0) * s;
    const egoRow = d.near.row0 === 0 ? 0 : VIEW;
    const up = d.near.row0 !== 0;
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(0, 0, W, W);

    // 网格：近景每格细线；每 10 格（8 m）粗线
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = Math.ceil(win.c0); i <= win.c0 + win.S; i++) {
      if (state.zoom === "full" || (i - 32) % 10 === 0) continue;
      ctx.moveTo(X(i), 0); ctx.lineTo(X(i), W);
    }
    for (let i = Math.ceil(win.r0); i <= win.r0 + win.S; i++) {
      if (state.zoom === "full" || (i - egoRow) % 10 === 0) continue;
      ctx.moveTo(0, Y(i)); ctx.lineTo(W, Y(i));
    }
    ctx.strokeStyle = COLORS.grid; ctx.stroke();
    ctx.beginPath();
    for (let i = Math.ceil(win.c0); i <= win.c0 + win.S; i++) if ((i - 32) % 10 === 0) { ctx.moveTo(X(i), 0); ctx.lineTo(X(i), W); }
    for (let i = Math.ceil(win.r0); i <= win.r0 + win.S; i++) if ((i - egoRow) % 10 === 0) { ctx.moveTo(0, Y(i)); ctx.lineTo(W, Y(i)); }
    ctx.strokeStyle = COLORS.grid10; ctx.stroke();

    // LiDAR 参考底图（整幅对应视野区域 64x64 格）
    const src = els.lidar.checked ? frameSource(c, "bev", k) : null;
    if (src) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(src.im, src.sx, src.sy, src.w, src.h, X(0), Y(0), VIEW * s, VIEW * s);
    }

    // 相机视场楔形（NCLT 前视：向上；Oxford 后视：向下，图像左侧 = 车辆右侧）
    const ex = X(32), ey = Y(egoRow), R = VIEW * 1.2 * s;
    const [aL, aR] = d.fov.map((a) => (a * Math.PI) / 180);
    const dirs = up ? [[-Math.sin(aL), -Math.cos(aL)], [Math.sin(aR), -Math.cos(aR)]]
                    : [[Math.sin(aL), Math.cos(aL)], [-Math.sin(aR), Math.cos(aR)]];
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = COLORS.fov;
    ctx.beginPath();
    dirs.forEach(([dx, dy]) => { ctx.moveTo(ex, ey); ctx.lineTo(ex + dx * R, ey + dy * R); });
    ctx.stroke();
    ctx.restore();

    // flow 区域
    const n = d.near.size, r0 = d.near.row0, c0 = d.near.col0;
    ctx.strokeStyle = COLORS.region;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(X(c0), Y(r0), n * s, n * s);
    ctx.font = "600 19px Inter, sans-serif";
    ctx.textBaseline = up ? "bottom" : "top";
    const regionText = "flow region · 32×32 cells (25.6 m)";

    // flow 箭头（近景每 2x2 格一个，全景每 4x4 格一个）/ 误差图（逐格）
    const base = k * 2 * n * n;
    if (state.flow === "err") {
      for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) {
        const i = base + r * n + q, j = i + n * n;
        ctx.fillStyle = errColor(Math.hypot(c.fp[i] - c.fg[i], c.fp[j] - c.fg[j]));
        ctx.fillRect(X(c0 + q) + 0.5, Y(r0 + r) + 0.5, s - 1, s - 1);
      }
    } else if (state.flow !== "off") {
      const step = state.zoom === "full" ? 4 : 2;
      const layers = state.flow === "both" ? [["gt", c.fg], ["pred", c.fp]] : [[state.flow, state.flow === "gt" ? c.fg : c.fp]];
      layers.forEach(([name, f]) => {
        ctx.strokeStyle = COLORS[name];
        ctx.lineWidth = state.zoom === "full" ? 2 : 2.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        for (let r = step / 2; r < n; r += step) for (let q = step / 2; q < n; q += step) {
          const i = base + r * n + q, j = i + n * n;
          const x0 = X(c0 + q), y0 = Y(r0 + r);     // 取 step x step 块中心的格点
          arrow(ctx, x0, y0, x0 + f[i] * s, y0 + f[j] * s, Math.max(6, s * 0.45));
        }
        ctx.stroke();
      });
    }

    // 自车（三角形指向车头方向 = 上）
    const L = Math.max(11, s * 0.9);
    ctx.fillStyle = COLORS.ego;
    ctx.beginPath();
    ctx.moveTo(ex, ey - L); ctx.lineTo(ex - L * 0.6, ey + L * 0.5); ctx.lineTo(ex + L * 0.6, ey + L * 0.5);
    ctx.closePath(); ctx.fill();
    // 文字最后画，压在箭头与点云之上
    label(ctx, regionText, X(c0) + 6, up ? Y(r0) - 6 : Y(r0 + n) + 6, COLORS.region);
    ctx.textBaseline = up ? "top" : "bottom";
    label(ctx, up ? "ego · camera faces up" : "ego · camera faces down", ex + L * 1.3, up ? ey - L * 0.4 : ey + L * 0.4,
      "rgba(255,255,255,.85)");

    // 比例尺 8 m
    const sb = 10 * s;
    ctx.strokeStyle = "rgba(255,255,255,.8)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W - sb - 16, W - 18); ctx.lineTo(W - 16, W - 18); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.textBaseline = "bottom";
    ctx.fillText("8 m", W - sb - 16, W - 24);

    // 误差模式色标
    if (state.flow === "err") {
      const gx = 16, gy = 14, gw = 180;
      for (let i = 0; i < gw; i++) { ctx.fillStyle = errColor(i / gw); ctx.fillRect(gx + i, gy, 1, 12); }
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.textBaseline = "top";
      ctx.fillText("flow EPE 0 → ≥1 cell (0.8 m)", gx, gy + 16);
    }
  }

  /* ------------------------------------------------------------ 相机图 */
  function drawCam(c, k) {
    const src = frameSource(c, "img", k);
    if (!src) return;
    const cv = els.cam;
    if (cv.width !== src.w || cv.height !== src.h) { cv.width = src.w; cv.height = src.h; }
    cv.getContext("2d").drawImage(src.im, src.sx, src.sy, src.w, src.h, 0, 0, src.w, src.h);
  }

  /* ------------------------------------------------------------ 轨迹 */
  function trajView(c) {
    // 视窗按片段范围一次性计算并缓存（屏幕：右 = 全局 y，上 = 全局 x）
    if (c.tv) return c.tv;
    const d = c.d, cv = els.traj, W = cv.width, H = cv.height;
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    d.clip_gt.concat(d.clip_pred).forEach(([x, y]) => {
      minx = Math.min(minx, y); maxx = Math.max(maxx, y); miny = Math.min(miny, x); maxy = Math.max(maxy, x);
    });
    const sc = Math.min((W - 40) / (maxx - minx + 8), (H - 70) / (maxy - miny + 8));
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    c.tv = { sc, P: ([x, y]) => [W / 2 + (y - cx) * sc, H / 2 + 8 - (x - cy) * sc] };
    return c.tv;
  }

  function drawTraj(c, k) {
    const d = c.d, cv = els.traj, ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
    const { sc, P } = trajView(c);
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(0, 0, W, H);
    const line = (arr, color, width, alpha, upto) => {
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round";
      ctx.beginPath();
      const n = upto === undefined ? arr.length : upto + 1;
      for (let i = 0; i < n; i++) { const [u, v] = P(arr[i]); i ? ctx.lineTo(u, v) : ctx.moveTo(u, v); }
      ctx.stroke(); ctx.globalAlpha = 1;
    };
    line(d.traj_gt, "#9aa4b2", 1.2, 0.3);
    line(d.clip_gt, "#e5e7eb", 2, 0.35);
    line(d.clip_pred, "#ff5a4a", 2, 0.35);
    line(d.clip_gt, "#e5e7eb", 2.6, 1, k);
    line(d.clip_pred, "#ff5a4a", 2.6, 1, k);
    const dot = (p, color) => { const [u, v] = P(p); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(u, v, 6, 0, 7); ctx.fill(); };
    dot(d.clip_gt[k], "#ffffff");
    dot(d.clip_pred[k], "#ff5a4a");
    const span = (W - 40) / sc;
    const m = Math.pow(10, Math.floor(Math.log10(span / 4)));
    const len = [1, 2, 5, 10].map((f) => f * m).filter((v) => v * sc < W * 0.3).pop() || m;
    ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(16, H - 16); ctx.lineTo(16 + len * sc, H - 16); ctx.stroke();
    ctx.font = "600 19px Inter, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.fillText(`${len} m`, 16, H - 24);
    ctx.fillStyle = "#e5e7eb"; ctx.fillText("— ground truth", 16, 26);
    ctx.fillStyle = "#ff5a4a"; ctx.fillText("— BEV-ODOM2", 170, 26);
  }

  /* ------------------------------------------------------------ 读数 */
  function fmt(v, digits) { return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(digits); }

  function drawReadout(c, k) {
    const d = c.d, p = d.ego_pred[k], g = d.ego_gt[k];
    els.readout.innerHTML =
      `<table><tr><th>frame pair ${k + 1}/${d.pairs} · Δt ${d.pair_dt} s</th><td class="p">Pred</td><td class="g">GT</td></tr>` +
      `<tr><th>forward (m)</th><td class="p">${fmt(p[0], 2)}</td><td class="g">${fmt(g[0], 2)}</td></tr>` +
      `<tr><th>lateral (m, +right)</th><td class="p">${fmt(p[1], 2)}</td><td class="g">${fmt(g[1], 2)}</td></tr>` +
      `<tr><th>yaw (°)</th><td class="p">${fmt(p[2], 2)}</td><td class="g">${fmt(g[2], 2)}</td></tr>` +
      `<tr><th>flow EPE</th><td colspan="2">${d.epe[k].toFixed(2)} cells (${(d.epe[k] * d.bev_res * 100).toFixed(0)} cm)</td></tr></table>`;
  }

  function draw() {
    const c = state.c;
    if (!c) return;
    const k = Math.min(state.k, c.d.pairs - 1);
    drawCam(c, k);
    drawBEV(c, k);
    drawTraj(c, k);
    drawReadout(c, k);
    els.frame.textContent = `${k + 1} / ${c.d.pairs}`;
    if (+els.slider.value !== k) els.slider.value = k;
  }

  /* ------------------------------------------------------------ 播放与控件 */
  function stop() {
    state.playing = false;
    cancelAnimationFrame(state.raf);
    els.play.innerHTML = "&#9654; Play";
  }

  function tick(t) {
    if (!state.playing) return;
    if (t - state.last >= 1000 / FPS) {
      state.last = t;
      state.k = (state.k + 1) % state.c.d.pairs;
      draw();
    }
    state.raf = requestAnimationFrame(tick);
  }

  function play() {
    if (!state.c || els.play.disabled) return;
    state.playing = true;
    state.last = 0;
    els.play.innerHTML = "&#10074;&#10074; Pause";
    state.raf = requestAnimationFrame(tick);
  }

  async function select(key) {
    stop();
    document.querySelectorAll("#ex-tabs .tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.key === key)));
    state.want = key;
    if (!state.cache[key]) {
      els.loading.hidden = false;
      els.play.disabled = true;
      els.progbar.style.width = "0%";
      els.progtxt.textContent = "Loading flow data…";
      let d;
      try {
        d = await loadData(key);
      } catch (err) {
        els.progtxt.textContent = `Could not load this clip (${err.message}).`;
        return;
      }
      if (state.want !== key) return;          // 加载期间用户已切换到另一段
      prepare(key, d);
    }
    state.c = state.cache[key];
    state.k = 0;
    const d = state.c.d;
    els.slider.max = d.pairs - 1;
    els.slider.value = 0;
    els.camname.textContent = `${d.dataset} · ${d.camera}`;
    els.trajsub.textContent = d.sequence;
    els.trajnote.textContent = `${d.pairs} frame pairs, prediction SE(2)-aligned over the clip. ` +
      `Whole sequence: RTE ${d.seq_rte.toFixed(2)}%, RRE ${d.seq_rre.toFixed(2)}°/100 m.`;
    progress();
    draw();
  }

  function segGroup(id, key) {
    const g = $(id);
    g.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      state[key] = b.dataset.v;
      draw();
    }));
  }

  els.play.addEventListener("click", () => (state.playing ? stop() : play()));
  els.slider.addEventListener("input", () => { stop(); state.k = +els.slider.value; draw(); });
  els.lidar.addEventListener("change", draw);
  segGroup("ex-flowmode", "flow");
  segGroup("ex-zoom", "zoom");
  document.querySelectorAll("#ex-tabs .tab").forEach((t) => t.addEventListener("click", () => select(t.dataset.key)));
  root.tabIndex = -1;
  root.addEventListener("keydown", (e) => {
    if (!state.c || e.target.tagName === "INPUT") return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      stop();
      const n = state.c.d.pairs;
      state.k = (state.k + (e.key === "ArrowRight" ? 1 : n - 1)) % n;
      draw();
      e.preventDefault();
    }
  });

  // 进入视口前再开始下载；离开视口自动暂停
  new IntersectionObserver((es, obs) => {
    if (es.some((e) => e.isIntersecting)) { obs.disconnect(); select("nclt"); }
  }, { rootMargin: "400px" }).observe(root);
  new IntersectionObserver((es) => { if (!es[0].isIntersecting) stop(); }).observe(root);
})();
