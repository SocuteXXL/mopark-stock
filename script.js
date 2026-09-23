// ============================================================
// สต๊อกรถมอภาค — main app script
// ============================================================

const ADMIN_PIN = "2569"; // change this to whatever PIN you want the admin to use

const IMAGE_FILES = [
  "IMG_0263.JPG","IMG_0264.JPG","IMG_0265.JPG","IMG_0266.JPG","IMG_0267.JPG",
  "IMG_0268.JPG","IMG_0269.JPG","IMG_0270.JPG","IMG_0271.JPG","IMG_0272.JPG",
  "IMG_0273.JPG","IMG_0274.JPG","IMG_0275.JPG","IMG_0276.JPG","IMG_0279.JPG",
  "IMG_0280.JPG","IMG_0281.JPG","IMG_0282.JPG","IMG_0283.JPG","IMG_0284.JPG",
  "IMG_0285.JPG","IMG_0286.JPG","IMG_0287.JPG","IMG_0288.JPG","IMG_0289.JPG",
  "IMG_0290.JPG","IMG_0291.JPG","IMG_0292.JPG","IMG_0293.JPG","IMG_0294.JPG",
  "IMG_0295.JPG","IMG_0296.JPG","IMG_0297.JPG","IMG_0298.JPG","IMG_0299.JPG",
  "IMG_0300.JPG","IMG_0301.JPG","IMG_0302.JPG","IMG_0303.JPG","IMG_0304.JPG",
  "IMG_0305.JPG","IMG_0306.JPG","IMG_0307.JPG","IMG_0308.JPG","IMG_0309.JPG",
  "IMG_0310.JPG","IMG_0311.JPG","IMG_0312.JPG","IMG_0313.JPG","IMG_0314.JPG",
  "IMG_0315.JPG","IMG_0316.JPG","IMG_0317.JPG","IMG_0318.JPG","IMG_0319.JPG",
  "IMG_0320.JPG","IMG_0321.JPG","IMG_0322.JPG","IMG_0323.JPG","IMG_0324.JPG",
  "IMG_0325.JPG","IMG_0326.JPG","IMG_0327.JPG","IMG_0328.JPG"
];

const DEFAULT_BRANDS = ["MITSUBISHI","TOYOTA","HONDA","ISUZU","SUZUKI","NISSAN","CHEVROLET","FORD"];

const LS = {
  overrides: "stockapp_overrides_v1",
  history: "stockapp_history_v1",
  theme: "stockapp_theme_v1"
};
const SS_ADMIN = "stockapp_admin_unlocked";

let CARS = [];
let OVERRIDES = {};   // { [id]: { images: [filenames], priceAdjust: "" } }
let HISTORY = [];     // [{ id, ts, brand, model, plate }]

let state = {
  page: "stock",
  view: "grid",
  search: "",
  brands: new Set(),
  priceMin: null,
  priceMax: null,
  sort: "",
  detailCarId: null,
  detailImgIndex: 0,
  pickerCarId: null,
  confirmCb: null,
  queueSearch: "",
  queueBrands: new Set(),
  shootTargetId: null
};

// ============================================================
// Utilities
// ============================================================
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function fmtMoney(n) {
  if (n === null || n === undefined || n === "" || isNaN(n)) return "-";
  return Number(n).toLocaleString("th-TH") + " บาท";
}
function isAdmin() { return sessionStorage.getItem(SS_ADMIN) === "1"; }

// Mileage isn't its own column in the source sheet — it's embedded as
// free text inside "ราคากลาง TTB" (e.g. "เลขไมล์ 154,444 KM TTB..."),
// with the odd typo "เลขไม" (missing ล์) here and there. Pull the
// number right after that label so sort-by-mileage has something to
// compare; cars with no parseable mileage sort to the end either way.
function getMileage(car) {
  const s = car["ราคากลาง TTB"];
  if (!s) return null;
  const m = s.match(/เลขไม(?:ล์)?\s*([\d,]+)/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return isNaN(n) ? null : n;
}

function toast(msg, ms = 2200) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, ms);
}

function saveOverrides() { localStorage.setItem(LS.overrides, JSON.stringify(OVERRIDES)); }
function saveHistory() { localStorage.setItem(LS.history, JSON.stringify(HISTORY)); }

function getOverride(id) {
  if (!OVERRIDES[id]) OVERRIDES[id] = { images: [], priceAdjust: "" };
  return OVERRIDES[id];
}

// A car only counts as "ready" (shown in stock + shoot queue) once it has
// at least one photo assigned. Cars without a photo stay in data.json /
// OVERRIDES untouched — this is a display filter, not a delete.
function hasPhoto(car) {
  const ov = OVERRIDES[car.id];
  return !!(ov && ov.images && ov.images.length > 0);
}
function getPhotoCars() {
  return CARS.filter(hasPhoto);
}

// ============================================================
// Init / data loading
// ============================================================
async function init() {
  loadTheme();
  bindGlobalEvents();

  try {
    const res = await fetch("data.json");
    CARS = await res.json();
  } catch (e) {
    CARS = [];
    console.error("Failed to load data.json", e);
  }

  const localOverrides = localStorage.getItem(LS.overrides);
  const localHistory = localStorage.getItem(LS.history);

  if (localOverrides) OVERRIDES = JSON.parse(localOverrides);
  if (localHistory) HISTORY = JSON.parse(localHistory);

  // Merge in the published overrides.json (if any) for cars this browser has no
  // local data for yet. Never overwrites an id already present locally, so the
  // admin's own edits always win, but new visitors still see published photos
  // even if overrides.json only appears after their first visit.
  try {
    const res = await fetch("overrides.json");
    if (res.ok) {
      const seed = await res.json();
      if (seed.overrides) {
        for (const [id, ov] of Object.entries(seed.overrides)) {
          if (!OVERRIDES[id]) OVERRIDES[id] = ov;
        }
      }
      if (!localHistory && seed.history && seed.history.length) HISTORY = seed.history;
      saveOverrides();
      saveHistory();
    }
  } catch (e) { /* no published overrides yet, that's fine */ }

  buildBrandFilters();
  renderAll();
}

// ============================================================
// Theme
// ============================================================
function loadTheme() {
  let theme = { accent: "blue", mode: "light" };
  try {
    const saved = JSON.parse(localStorage.getItem(LS.theme));
    if (saved) theme = saved;
  } catch (e) {}
  applyTheme(theme);
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-accent", theme.accent);
  document.documentElement.setAttribute("data-mode", theme.mode);
  $all(".swatch").forEach(s => s.classList.toggle("active", s.dataset.accent === theme.accent));
  $("#modeToggle").textContent = theme.mode === "dark" ? "☀️" : "🌙";
  localStorage.setItem(LS.theme, JSON.stringify(theme));
}
function getTheme() {
  return {
    accent: document.documentElement.getAttribute("data-accent"),
    mode: document.documentElement.getAttribute("data-mode")
  };
}

// ============================================================
// Brand filter chips (shared builder for the stock page and the
// queue page, each with its own selector element and Set of state)
// ============================================================
function buildBrandFiltersInto(wrapId, brandSet, onChange) {
  const found = new Set(CARS.map(c => c["ยี่ห้อ"]).filter(Boolean));
  const ordered = DEFAULT_BRANDS.filter(b => found.has(b));
  found.forEach(b => { if (!ordered.includes(b)) ordered.push(b); });

  const wrap = $(wrapId);
  wrap.innerHTML = ordered.map(b =>
    `<button type="button" class="brand-chip" data-brand="${esc(b)}">${esc(b)}</button>`
  ).join("");

  wrap.querySelectorAll(".brand-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const b = btn.dataset.brand;
      if (brandSet.has(b)) brandSet.delete(b); else brandSet.add(b);
      btn.classList.toggle("active");
      onChange();
    });
  });
}
function buildBrandFilters() {
  buildBrandFiltersInto("#brandFilters", state.brands, renderStock);
  buildBrandFiltersInto("#queueBrandFilters", state.queueBrands, renderQueue);
}

// ============================================================
// Filtering / sorting
// ============================================================
function getFilteredCars() {
  let list = getPhotoCars();

  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    list = list.filter(c => {
      const hay = [
        c["ทะเบียนเดิม"], c["ทะเบียนใหม่"], c["ยี่ห้อ"], c["ชนิดรถ"], c["สี"],
        c["เลขเครื่อง"], c["เลขตัวรถ"], c["สต๊อก"], c["ซื้อรถจาก"], c["วันที่ซื้อ"], c["ที่จอด"]
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  if (state.brands.size > 0) {
    list = list.filter(c => state.brands.has(c["ยี่ห้อ"]));
  }

  if (state.priceMin !== null || state.priceMax !== null) {
    list = list.filter(c => {
      const p = c["ราคาขาย_num"];
      if (p === null || p === undefined) return false;
      if (state.priceMin !== null && p < state.priceMin) return false;
      if (state.priceMax !== null && p > state.priceMax) return false;
      return true;
    });
  }

  if (state.sort === "price-asc") {
    list.sort((a, b) => (a["ราคาขาย_num"] ?? Infinity) - (b["ราคาขาย_num"] ?? Infinity));
  } else if (state.sort === "price-desc") {
    list.sort((a, b) => (b["ราคาขาย_num"] ?? -Infinity) - (a["ราคาขาย_num"] ?? -Infinity));
  } else if (state.sort === "year-desc") {
    list.sort((a, b) => (b["ปีรถ_num"] ?? -Infinity) - (a["ปีรถ_num"] ?? -Infinity));
  } else if (state.sort === "year-asc") {
    list.sort((a, b) => (a["ปีรถ_num"] ?? Infinity) - (b["ปีรถ_num"] ?? Infinity));
  } else if (state.sort === "mileage-asc") {
    list.sort((a, b) => (getMileage(a) ?? Infinity) - (getMileage(b) ?? Infinity));
  } else if (state.sort === "mileage-desc") {
    list.sort((a, b) => (getMileage(b) ?? -Infinity) - (getMileage(a) ?? -Infinity));
  }

  return list;
}

// ============================================================
// Stock page: table + grid rendering
// ============================================================
function renderStock() {
  const list = getFilteredCars();
  const photoTotal = getPhotoCars().length;
  $("#resultCount").textContent = `พบ ${list.length} คัน จากทั้งหมด ${photoTotal} คัน (แสดงเฉพาะคันที่มีรูปภาพ)`;

  if (state.view === "table") renderTable(list);
  else renderGrid(list);
}

function renderTable(list) {
  const body = $("#tableBody");
  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="10" class="empty-state">ไม่พบรถที่ตรงกับเงื่อนไข</td></tr>`;
    return;
  }
  body.innerHTML = list.map(c => {
    const ov = getOverride(c.id);
    return `
    <tr>
      <td class="sticky-col sticky-col-1">${esc(c["ทะเบียนเดิม"]) || "-"}</td>
      <td class="sticky-col sticky-col-2">${esc(c["ยี่ห้อ"]) || "-"}</td>
      <td class="sticky-col sticky-col-3">${esc(c["ชนิดรถ"]) || "-"}</td>
      <td>${esc(c["ทะเบียนใหม่"]) || "-"}</td>
      <td>${esc(c["วันที่ซื้อ"]) || "-"}</td>
      <td>${esc(c["สี"]) || "-"}</td>
      <td>${esc(c["ราคากลาง TTB"]) || "-"}</td>
      <td>${fmtMoney(c["ราคาขาย_num"])}</td>
      <td>${esc(ov.priceAdjust) || "-"}</td>
      <td class="col-action">
        <div class="row-actions">
          <button class="btn-detail" data-open-detail="${esc(c.id)}">รายละเอียด</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  body.querySelectorAll("[data-open-detail]").forEach(btn => {
    btn.addEventListener("click", () => openDetail(btn.dataset.openDetail));
  });
}

function renderGrid(list) {
  const grid = $("#gridView");
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state">ไม่พบรถที่ตรงกับเงื่อนไข</div>`;
    return;
  }
  grid.innerHTML = list.map(c => {
    const ov = getOverride(c.id);
    const img = ov.images && ov.images[0];
    const thumb = img
      ? `<img class="car-card-thumb" src="images/${esc(img)}" alt="">`
      : `<div class="car-card-thumb placeholder"></div>`;
    return `
    <div class="car-card">
      ${thumb}
      <div class="car-card-body">
        <p class="car-card-title">${esc(c["ยี่ห้อ"]) || "-"} ${esc(c["ชนิดรถ"]) || ""}</p>
        <p class="car-card-sub">${esc(c["ทะเบียนใหม่"]) || esc(c["ทะเบียนเดิม"]) || "-"} · ปี ${esc(c["ปีรถ"]) || "-"} · ${esc(c["สี"]) || "-"}</p>
        <p class="car-card-price">${fmtMoney(c["ราคาขาย_num"])}</p>
        <button class="car-card-detail-btn" data-open-detail="${esc(c.id)}">รายละเอียด</button>
      </div>
    </div>`;
  }).join("");

  grid.querySelectorAll("[data-open-detail]").forEach(btn => {
    btn.addEventListener("click", () => openDetail(btn.dataset.openDetail));
  });
}

// ============================================================
// Detail modal
// ============================================================
function openDetail(id) {
  state.detailCarId = id;
  state.detailImgIndex = 0;
  renderDetail();
  $("#detailModal").hidden = false;
}
function closeDetail() {
  $("#detailModal").hidden = true;
  state.detailCarId = null;
}

function renderDetail() {
  const c = CARS.find(x => x.id === state.detailCarId);
  if (!c) return;
  const ov = getOverride(c.id);
  const images = ov.images || [];
  const admin = isAdmin();

  let galleryHtml = "";
  if (images.length > 0) {
    const activeImg = images[Math.min(state.detailImgIndex, images.length - 1)];
    galleryHtml = `
      <img class="detail-gallery-main" src="images/${esc(activeImg)}" alt="">
      <div class="detail-gallery-thumbs">
        ${images.map((img, i) => `<img src="images/${esc(img)}" class="${i === state.detailImgIndex ? "active" : ""}" data-thumb-idx="${i}" alt="">`).join("")}
        ${admin ? `<button class="btn-ghost-sm" data-open-picker="1">+ จัดการรูป</button>` : ""}
      </div>`;
  } else {
    galleryHtml = `
      <div class="detail-gallery-empty"></div>
      ${admin ? `<div class="detail-gallery-thumbs"><button class="btn-ghost-sm" data-open-picker="1">+ เพิ่มรูปภาพ</button></div>` : ""}`;
  }

  const fields = [
    ["ทะเบียนเดิม", c["ทะเบียนเดิม"]],
    ["ยี่ห้อ", c["ยี่ห้อ"]],
    ["ชนิดรถ", c["ชนิดรถ"]],
    ["ทะเบียนใหม่", c["ทะเบียนใหม่"]],
    ["วันที่ซื้อ", c["วันที่ซื้อ"]],
    ["สี", c["สี"]],
    ["ราคากลาง TTB", c["ราคากลาง TTB"]],
    ["ราคาขาย", fmtMoney(c["ราคาขาย_num"])],
    ["ปีรถ", c["ปีรถ"]],
    ["ที่จอด", c["ที่จอด"]],
    ["เลขเครื่อง", c["เลขเครื่อง"]],
    ["เลขตัวรถ", c["เลขตัวรถ"]],
    ["สต๊อก", c["สต๊อก"]],
    ["ซื้อรถจาก", c["ซื้อรถจาก"]]
  ];

  const fieldsHtml = fields.map(([label, val]) => `
    <div class="detail-field">
      <div class="label">${esc(label)}</div>
      <div class="value">${esc(val) || "-"}</div>
    </div>`).join("");

  const priceAdjustHtml = admin
    ? `<div class="detail-field">
         <div class="label">ปรับราคา</div>
         <input type="text" class="value-input" id="priceAdjustInput" value="${esc(ov.priceAdjust)}" placeholder="เช่น ลดราคาเหลือ 359,000">
       </div>`
    : `<div class="detail-field">
         <div class="label">ปรับราคา</div>
         <div class="value">${esc(ov.priceAdjust) || "-"}</div>
       </div>`;

  $("#detailBody").innerHTML = `
    ${galleryHtml}
    <div class="detail-grid">${fieldsHtml}${priceAdjustHtml}</div>
    ${!admin ? `<p class="locked-hint">🔒 ปลดล็อกโหมดแก้ไขเพื่อแก้ไขราคาหรือจัดการรูปภาพ</p>` : ""}
  `;

  $all("[data-thumb-idx]").forEach(el => {
    el.addEventListener("click", () => { state.detailImgIndex = Number(el.dataset.thumbIdx); renderDetail(); });
  });
  const openPickerBtn = $("[data-open-picker]");
  if (openPickerBtn) openPickerBtn.addEventListener("click", () => openImagePicker(c.id));

  const priceInput = $("#priceAdjustInput");
  if (priceInput) {
    priceInput.addEventListener("change", () => {
      getOverride(c.id).priceAdjust = priceInput.value;
      saveOverrides();
      renderStock();
      toast("บันทึกการปรับราคาแล้ว");
    });
  }
}

// ============================================================
// Image picker modal
// ============================================================
function openImagePicker(carId) {
  state.pickerCarId = carId;
  const ov = getOverride(carId);
  $("#imagePickerGrid").innerHTML = IMAGE_FILES.map(f => `
    <img src="images/${esc(f)}" data-img="${esc(f)}" class="${(ov.images || []).includes(f) ? "selected" : ""}" alt="">
  `).join("");
  $all("#imagePickerGrid img").forEach(img => {
    img.addEventListener("click", () => {
      const ov2 = getOverride(state.pickerCarId);
      ov2.images = ov2.images || [];
      const f = img.dataset.img;
      const idx = ov2.images.indexOf(f);
      if (idx >= 0) ov2.images.splice(idx, 1); else ov2.images.push(f);
      img.classList.toggle("selected");
      saveOverrides();
      renderDetail();
      renderStock();
    });
  });
  $("#imagePickerModal").hidden = false;
}
function closeImagePicker() { $("#imagePickerModal").hidden = true; }

// ============================================================
// Queue: round-robin CYCLES (shoot every car once before any car
// repeats), but free choice of WHICH car to shoot next within a
// cycle. Only cars with a photo are ever in the queue.
//
// Still fully derived from HISTORY, not a separately-tracked set:
// the last (HISTORY.length % n) entries ARE this cycle's shots, in
// whatever order the admin picked them. That's what keeps
// cancel-last a plain HISTORY.pop() with nothing else to desync.
// ============================================================
function getQueueInfo() {
  const queueCars = getPhotoCars();
  const n = queueCars.length;
  const total = HISTORY.length;
  const pos = n > 0 ? total % n : 0;
  const cycle = n > 0 ? Math.floor(total / n) + 1 : 1;
  const shotThisCycle = new Set(HISTORY.slice(total - pos).map(h => h.id));
  return { queueCars, n, total, pos, cycle, shotThisCycle };
}

// Search/brand filters on the queue page only narrow which cards are
// VISIBLE — they never change queueCars/n itself, so the round-robin
// cycle math above always reflects every photographed car regardless
// of what the admin is currently searching for.
function getFilteredQueueCars(queueCars) {
  let list = queueCars;
  if (state.queueSearch.trim()) {
    const q = state.queueSearch.trim().toLowerCase();
    list = list.filter(c => {
      const hay = [
        c["ทะเบียนเดิม"], c["ทะเบียนใหม่"], c["ยี่ห้อ"], c["ชนิดรถ"], c["สี"]
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }
  if (state.queueBrands.size > 0) {
    list = list.filter(c => state.queueBrands.has(c["ยี่ห้อ"]));
  }
  return list;
}

function renderQueue() {
  const { queueCars, n, pos, cycle, shotThisCycle } = getQueueInfo();
  const admin = isAdmin();

  $("#queueProgressText").textContent = `${pos} / ${n} คัน (รอบที่ ${cycle})`;
  $("#queueProgressFill").style.width = n > 0 ? `${(pos / n) * 100}%` : "0%";

  renderHistory();

  if (n === 0) {
    $("#queueList").innerHTML = `<div class="empty-state">ยังไม่มีรถที่มีรูปภาพในคิวถ่ายคลิป (เพิ่มรูปให้รถในสต๊อกก่อน)</div>`;
    return;
  }

  const displayCars = getFilteredQueueCars(queueCars);
  if (displayCars.length === 0) {
    $("#queueList").innerHTML = `<div class="empty-state">ไม่พบรถที่ตรงกับเงื่อนไข</div>`;
    return;
  }

  $("#queueList").innerHTML = displayCars.map(c => {
    const ov = getOverride(c.id);
    const img = ov.images && ov.images[0];
    const thumb = img ? `<img class="queue-item-thumb" src="images/${esc(img)}" alt="" data-view-detail="${esc(c.id)}">`
                       : `<div class="queue-item-thumb car-card-thumb placeholder" style="width:48px;height:48px;"></div>`;
    const isShot = shotThisCycle.has(c.id);
    const badge = isShot
      ? `<span class="queue-badge">ถ่ายแล้ว (รอบนี้)</span>`
      : `<span class="queue-badge">รอถ่าย</span>`;
    let actionHtml;
    if (isShot) {
      actionHtml = "";
    } else if (admin) {
      actionHtml = `<button class="btn-shot" data-shot="${esc(c.id)}">ถ่ายแล้ววันนี้</button>`;
    } else {
      actionHtml = `<span class="locked-hint">ล็อกอยู่</span>`;
    }
    return `
    <div class="queue-item ${isShot ? "shot" : ""}">
      ${thumb}
      <div class="queue-item-info" data-view-detail="${esc(c.id)}">
        <div class="name">${esc(c["ยี่ห้อ"]) || "-"} ${esc(c["ชนิดรถ"]) || ""}</div>
        <div class="sub">${esc(c["ทะเบียนใหม่"]) || esc(c["ทะเบียนเดิม"]) || "-"}</div>
      </div>
      ${badge}
      ${actionHtml}
    </div>`;
  }).join("");

  $all("[data-shot]").forEach(btn => {
    btn.addEventListener("click", () => openShootModal(btn.dataset.shot));
  });
  $all("[data-view-detail]").forEach(el => {
    el.addEventListener("click", () => openDetail(el.dataset.viewDetail));
  });
}

function markShot(id, customTs) {
  const { shotThisCycle } = getQueueInfo();
  const c = getPhotoCars().find(x => x.id === id);
  if (!c || shotThisCycle.has(id)) { renderQueue(); return; } // stale click guard (already shot this cycle, or no longer has a photo)
  HISTORY.push({
    id: c.id,
    ts: customTs || Date.now(),
    brand: c["ยี่ห้อ"] || "",
    model: c["ชนิดรถ"] || "",
    plate: c["ทะเบียนใหม่"] || c["ทะเบียนเดิม"] || ""
  });
  saveHistory();
  const after = getQueueInfo();
  toast(`บันทึกแล้ว: ถ่าย ${c["ยี่ห้อ"] || ""} ${c["ชนิดรถ"] || ""}`);
  if (after.pos === 0 && after.cycle > 1) {
    setTimeout(() => toast(`ครบรอบแล้ว! เริ่มรอบที่ ${after.cycle}`), 2300);
  }
  renderQueue();
}

// ============================================================
// Shoot modal: choose "shot today" (now) or pick a custom date/time
// ============================================================
function openShootModal(id) {
  const c = getPhotoCars().find(x => x.id === id);
  if (!c) { renderQueue(); return; }
  state.shootTargetId = id;
  $("#shootModalTitle").textContent = `บันทึกว่าถ่าย ${c["ยี่ห้อ"] || ""} ${c["ชนิดรถ"] || ""} แล้ว`;
  $("#shootTimePicker").hidden = true;
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  $("#shootTimeInput").value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  $("#shootModal").hidden = false;
}
function closeShootModal() {
  $("#shootModal").hidden = true;
  state.shootTargetId = null;
}

// ============================================================
// History page
// ============================================================
function renderHistory() {
  if (HISTORY.length === 0) {
    $("#historyList").innerHTML = `<div class="empty-state">ยังไม่มีประวัติการถ่ายคลิป</div>`;
    return;
  }
  const reversed = HISTORY.slice().reverse();
  const admin = isAdmin();

  $("#historyList").innerHTML = reversed.map((h, i) => {
    const ov = getOverride(h.id);
    const img = ov.images && ov.images[0];
    const thumb = img ? `<img class="history-item-thumb" src="images/${esc(img)}" alt="" data-view-detail="${esc(h.id)}">`
                       : `<div class="history-item-thumb car-card-thumb placeholder" style="width:48px;height:48px;"></div>`;
    const dt = new Date(h.ts);
    const dtStr = dt.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
    const isLatest = i === 0;
    return `
    <div class="history-item">
      ${thumb}
      <div class="history-item-info">
        <div class="name">${esc(h.brand)} ${esc(h.model)}</div>
        <div class="sub">${esc(h.plate) || "-"} · ${dtStr}</div>
      </div>
      ${isLatest && admin ? `<button class="btn-cancel-latest" id="cancelLatestBtn">ยกเลิกรายการนี้</button>` : ""}
    </div>`;
  }).join("");

  $all("#historyList [data-view-detail]").forEach(el => {
    el.addEventListener("click", () => openDetail(el.dataset.viewDetail));
  });

  const cancelBtn = $("#cancelLatestBtn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      showConfirm("ต้องการที่จะยกเลิกรายการถ่ายล่าสุดใช่หรือไม่?", () => {
        HISTORY.pop();
        saveHistory();
        renderQueue();
        toast("ยกเลิกรายการล่าสุดแล้ว");
      });
    });
  }
}

// ============================================================
// Generic confirm modal
// ============================================================
function showConfirm(text, onConfirm) {
  $("#confirmText").textContent = text;
  state.confirmCb = onConfirm;
  $("#confirmModal").hidden = false;
}
function closeConfirm() { $("#confirmModal").hidden = true; state.confirmCb = null; }

// ============================================================
// Admin PIN gate
// ============================================================
function openPinModal() {
  $("#pinInput").value = "";
  $("#pinError").hidden = true;
  $("#pinModal").hidden = false;
  $("#pinInput").focus();
}
function closePinModal() { $("#pinModal").hidden = true; }

function tryUnlock() {
  const val = $("#pinInput").value;
  if (val === ADMIN_PIN) {
    sessionStorage.setItem(SS_ADMIN, "1");
    closePinModal();
    updateAdminUI();
    toast("ปลดล็อกโหมดแก้ไขแล้ว");
  } else {
    $("#pinError").hidden = false;
  }
}
function lockAdmin() {
  sessionStorage.removeItem(SS_ADMIN);
  updateAdminUI();
  toast("ล็อกโหมดแก้ไขแล้ว (โหมดดูอย่างเดียว)");
}
function updateAdminUI() {
  const btn = $("#adminToggle");
  const admin = isAdmin();
  btn.classList.toggle("unlocked", admin);
  btn.textContent = admin ? "🔓" : "🔒";
  renderAll();
}

// ============================================================
// Save button (explicit manual save, per user request)
// ============================================================
function manualSave() {
  saveOverrides();
  saveHistory();
  localStorage.setItem(LS.theme, JSON.stringify(getTheme()));
  $("#saveStatus").textContent = "บันทึกล่าสุด: " + new Date().toLocaleTimeString("th-TH");
  toast("บันทึกข้อมูลเรียบร้อยแล้ว");
}

// ============================================================
// Page switching
// ============================================================
function switchPage(page) {
  state.page = page;
  $all(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  $all(".page").forEach(p => p.classList.toggle("active", p.id === `page-${page}`));
  renderAll();
}

function renderAll() {
  if (state.page === "stock") renderStock();
  else if (state.page === "queue") renderQueue();
}

// ============================================================
// Global event bindings
// ============================================================
function bindGlobalEvents() {
  $all(".tab-btn").forEach(btn => btn.addEventListener("click", () => switchPage(btn.dataset.page)));

  $("#searchInput").addEventListener("input", e => { state.search = e.target.value; renderStock(); });

  $all(".view-btn").forEach(btn => btn.addEventListener("click", () => {
    state.view = btn.dataset.view;
    $all(".view-btn").forEach(b => b.classList.toggle("active", b === btn));
    $("#tableView").hidden = state.view !== "table";
    $("#gridView").hidden = state.view !== "grid";
    renderStock();
  }));

  $("#sortSelect").addEventListener("change", e => { state.sort = e.target.value; renderStock(); });

  $("#priceMin").addEventListener("input", e => {
    state.priceMin = e.target.value === "" ? null : Number(e.target.value);
    renderStock();
  });
  $("#priceMax").addEventListener("input", e => {
    state.priceMax = e.target.value === "" ? null : Number(e.target.value);
    renderStock();
  });
  $("#priceClear").addEventListener("click", () => {
    state.priceMin = null; state.priceMax = null;
    $("#priceMin").value = ""; $("#priceMax").value = "";
    renderStock();
  });

  $all(".swatch").forEach(sw => sw.addEventListener("click", () => {
    const theme = getTheme();
    theme.accent = sw.dataset.accent;
    applyTheme(theme);
  }));
  $("#modeToggle").addEventListener("click", () => {
    const theme = getTheme();
    theme.mode = theme.mode === "dark" ? "light" : "dark";
    applyTheme(theme);
  });

  $("#adminToggle").addEventListener("click", () => {
    if (isAdmin()) lockAdmin(); else openPinModal();
  });
  $("#pinModalClose").addEventListener("click", closePinModal);
  $("#pinCancelBtn").addEventListener("click", closePinModal);
  $("#pinOkBtn").addEventListener("click", tryUnlock);
  $("#pinInput").addEventListener("keydown", e => { if (e.key === "Enter") tryUnlock(); });

  $("#detailModalClose").addEventListener("click", closeDetail);
  $("#detailModal").addEventListener("click", e => { if (e.target.id === "detailModal") closeDetail(); });

  $("#imagePickerClose").addEventListener("click", closeImagePicker);
  $("#imagePickerModal").addEventListener("click", e => { if (e.target.id === "imagePickerModal") closeImagePicker(); });

  $("#confirmCancelBtn").addEventListener("click", closeConfirm);
  $("#confirmOkBtn").addEventListener("click", () => {
    const cb = state.confirmCb;
    closeConfirm();
    if (cb) cb();
  });

  $("#saveBtn").addEventListener("click", manualSave);

  $("#queueSearchInput").addEventListener("input", e => { state.queueSearch = e.target.value; renderQueue(); });

  $("#shootModalClose").addEventListener("click", closeShootModal);
  $("#shootModal").addEventListener("click", e => { if (e.target.id === "shootModal") closeShootModal(); });
  $("#shootNowBtn").addEventListener("click", () => {
    const id = state.shootTargetId;
    closeShootModal();
    if (id) markShot(id);
  });
  $("#shootPickTimeBtn").addEventListener("click", () => { $("#shootTimePicker").hidden = false; });
  $("#shootTimeConfirmBtn").addEventListener("click", () => {
    const id = state.shootTargetId;
    const val = $("#shootTimeInput").value;
    if (!id || !val) return;
    const ts = new Date(val).getTime();
    closeShootModal();
    markShot(id, ts);
  });
}

document.addEventListener("DOMContentLoaded", init);
