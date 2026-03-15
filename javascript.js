"use strict";

/*
  タイムゾーン固定: Asia/Tokyo
  表示ロケール: ja-JP
*/
const TZ = "Asia/Tokyo";
const LOCALE = "ja-JP";

const STORAGE_KEY = "kintai_pwa_v1";
const HARD_RELOAD_STEP_KEY = "kintai_hard_reload_step";
const DEFAULT_COMPANY_HOLIDAY_NAME = "会社休日";
const IMAGE_DB_NAME = "kintai_pwa_assets_v1";
const IMAGE_STORE_NAME = "reaction_images";

const DEFAULTS = {
  hourlyWage: 1500,
  year: null,
  // yearData[YYYY] = { companyHolidays: [{ date:"YYYY-MM-DD", name:"休日名" }, ...], days: { "YYYY-MM-DD": { in:"HH:MM"|null, out:"HH:MM"|null, category:"normal"|"paid_leave"|"holiday_work", note:"", noteOpen:boolean } } }
  yearData: {}
};

const CATEGORY = {
  NORMAL: "normal",
  PAID_LEAVE: "paid_leave",
  HOLIDAY_WORK: "holiday_work",
  ABSENCE: "absence"
};

const REACTION_SLOT = {
  CLOCK_IN: "clock_in",
  CLOCK_OUT: "clock_out",
  MONTH_END_WITH_ABSENCE: "month_end_with_absence",
  MONTH_END_PERFECT: "month_end_perfect",
  HALF_MONTH: "half_month",
  WEEK_END: "week_end"
};

const REACTION_IMAGE_SLOTS = [
  { id: REACTION_SLOT.CLOCK_IN, label: "1. 出勤時" },
  { id: REACTION_SLOT.CLOCK_OUT, label: "2. 退勤時" },
  { id: REACTION_SLOT.MONTH_END_WITH_ABSENCE, label: "3. 月末退勤（欠勤あり）" },
  { id: REACTION_SLOT.MONTH_END_PERFECT, label: "4. 月末退勤（欠勤なし）" },
  { id: REACTION_SLOT.HALF_MONTH, label: "5. 月の半分到達日" },
  { id: REACTION_SLOT.WEEK_END, label: "6. 週の終わり" }
];

const DEFAULT_REACTION_TEXT = {
  [REACTION_SLOT.CLOCK_IN]: "今日も会社来てエラい✨",
  [REACTION_SLOT.CLOCK_OUT]: "1日お疲れさまでした☕",
  [REACTION_SLOT.MONTH_END_WITH_ABSENCE]: "今月もお疲れさまでした",
  [REACTION_SLOT.MONTH_END_PERFECT]: "今月も皆勤お見事です",
  [REACTION_SLOT.HALF_MONTH]: "今月もちょうど折り返しです",
  [REACTION_SLOT.WEEK_END]: "今週もよく頑張りました"
};

function nowTokyoParts() {
  const fmt = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = fmt.formatToParts(new Date());
  const get = (type) => parts.find(p => p.type === type)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute"))
  };
}

function pad2(n) { return String(n).padStart(2, "0"); }

function ymd(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

function minutesFromHHMM(hhmm) {
  if (!hhmm) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

function hhmmFromMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function roundToMinuteHHMM() {
  const p = nowTokyoParts();
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

function weekdayShortJa(year, month, day) {
  const dt = new Date(Date.UTC(year, month - 1, day));
  // UTCを使っても weekday 判定は「日付に対して」なので影響が少ないが、
  // 念のため Asia/Tokyo でフォーマットする
  const fmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, weekday: "short" });
  return fmt.format(dt);
}

function formatDateLine(year, month, day, holidayName) {
  const wd = weekdayShortJa(year, month, day);
  const datePart = `${month}/${day} ${wd}`; // 半角スペース1つのみ
  return { datePart, holidayName: holidayName || "" };
}

function getTodayContext() {
  const p = nowTokyoParts();
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    key: ymd(p.year, p.month, p.day)
  };
}

function formatDateTimeLabel(timestamp) {
  if (!timestamp) return "保存日不明";
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(timestamp));
}

function normalizeCompanyHolidayList(rawList) {
  if (!Array.isArray(rawList)) return [];

  const byDate = new Map();
  for (const entry of rawList) {
    let date = "";
    let name = "";

    if (typeof entry === "string") {
      date = entry;
    } else if (entry && typeof entry === "object" && typeof entry.date === "string") {
      date = entry.date;
      if (typeof entry.name === "string") name = entry.name.trim();
    } else {
      continue;
    }

    if (!parseYmd(date)) continue;

    // 同日の重複がある場合は「名前あり」を優先
    if (!byDate.has(date) || name) {
      byDate.set(date, name.slice(0, 40));
    }
  }

  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, name]) => ({ date, name }));
}

function normalizeCompanyHolidayName(name) {
  const trimmed = String(name || "").trim();
  if (trimmed) return trimmed.slice(0, 40);
  return "";
}

/* ----------------------------
   永続化
---------------------------- */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const p = nowTokyoParts();
      const st = structuredClone(DEFAULTS);
      st.year = p.year;
      st.yearData[String(p.year)] = { companyHolidays: [], days: {} };
      return st;
    }
    const parsed = JSON.parse(raw);
    const st = structuredClone(DEFAULTS);
    if (typeof parsed.hourlyWage === "number") st.hourlyWage = parsed.hourlyWage;
    if (typeof parsed.year === "number") st.year = parsed.year;
    if (parsed.yearData && typeof parsed.yearData === "object") st.yearData = parsed.yearData;

    if (!st.year) {
      const p = nowTokyoParts();
      st.year = p.year;
    }
    if (!st.yearData[String(st.year)]) st.yearData[String(st.year)] = { companyHolidays: [], days: {} };

    return st;
  } catch {
    const p = nowTokyoParts();
    const st = structuredClone(DEFAULTS);
    st.year = p.year;
    st.yearData[String(p.year)] = { companyHolidays: [], days: {} };
    return st;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ----------------------------
   祝日判定（日本）
   - 2000〜2099想定
   - 振替休日・国民の休日を含む
---------------------------- */
function nthMonday(year, month, nth) {
  // month: 1..12
  // return day number
  const first = new Date(Date.UTC(year, month - 1, 1));
  // 0=Sun ... 1=Mon
  const firstDow = first.getUTCDay();
  const offsetToMon = (1 - firstDow + 7) % 7;
  const day = 1 + offsetToMon + (nth - 1) * 7;
  return day;
}

function vernalEquinoxDay(year) {
  // 2000-2099 approximate
  // 参考: 国立天文台等で用いられる近似式の一般形
  // 2000-2099: floor(20.8431 + 0.242194*(year-2000) - floor((year-2000)/4))
  const y = year - 2000;
  return Math.floor(20.8431 + 0.242194 * y - Math.floor(y / 4));
}

function autumnalEquinoxDay(year) {
  // 2000-2099:
  // floor(23.2488 + 0.242194*(year-2000) - floor((year-2000)/4))
  const y = year - 2000;
  return Math.floor(23.2488 + 0.242194 * y - Math.floor(y / 4));
}

function buildBaseHolidays(year) {
  // Map: "YYYY-MM-DD" -> name
  const map = new Map();

  const add = (m, d, name) => map.set(ymd(year, m, d), name);

  // 固定祝日（法律変更の影響があるので年で分岐）
  // 元日
  add(1, 1, "元日");

  // 成人の日: 2000年以降 第2月曜
  add(1, nthMonday(year, 1, 2), "成人の日");

  // 建国記念の日
  add(2, 11, "建国記念の日");

  // 天皇誕生日: 2020〜 2/23
  if (year >= 2020) add(2, 23, "天皇誕生日");

  // 春分の日
  add(3, vernalEquinoxDay(year), "春分の日");

  // 昭和の日
  add(4, 29, "昭和の日");

  // 憲法記念日 / みどりの日 / こどもの日
  add(5, 3, "憲法記念日");
  add(5, 4, "みどりの日");
  add(5, 5, "こどもの日");

  // 海の日: 原則 第3月曜（2003〜）
  // 2020/2021は五輪対応の特例あり
  if (year === 2020) {
    add(7, 23, "海の日");
  } else if (year === 2021) {
    add(7, 22, "海の日");
  } else {
    add(7, nthMonday(year, 7, 3), "海の日");
  }

  // 山の日: 2016〜
  // 2020/2021は特例
  if (year >= 2016) {
    if (year === 2020) {
      add(8, 10, "山の日");
    } else if (year === 2021) {
      add(8, 8, "山の日"); // 8/8が山の日、翌日が振替になる
    } else {
      add(8, 11, "山の日");
    }
  }

  // 敬老の日: 第3月曜（2003〜）
  add(9, nthMonday(year, 9, 3), "敬老の日");

  // 秋分の日
  add(9, autumnalEquinoxDay(year), "秋分の日");

  // スポーツの日: 2000〜第2月曜（当初は体育の日→スポーツの日名称変更）
  // 2020/2021特例
  if (year === 2020) {
    add(7, 24, "スポーツの日");
  } else if (year === 2021) {
    add(7, 23, "スポーツの日");
  } else {
    add(10, nthMonday(year, 10, 2), "スポーツの日");
  }

  // 文化の日
  add(11, 3, "文化の日");

  // 勤労感謝の日
  add(11, 23, "勤労感謝の日");

  // 一時的祝日（主なもの）
  // 2019: 即位の日(5/1), 即位礼正殿の儀(10/22)
  if (year === 2019) {
    add(5, 1, "即位の日");
    add(10, 22, "即位礼正殿の儀");
  }
  // 2019: 皇太子徳仁親王の即位に伴う特例で4/30, 5/2が国民の休日扱い相当になるが
  // ここでは「国民の休日」計算で自動的に休日化される（4/30と5/2は間に挟まれる構造になる）
  // ただし4/30は「休日」扱い（名称は法律上は休日）になるため、名称は空でも休日扱いにするのが自然。
  // ここでは4/30, 5/2を明示的に「休日」として扱うために入れておく。
  if (year === 2019) {
    map.set(ymd(year, 4, 30), "休日");
    map.set(ymd(year, 5, 2), "休日");
  }

  return map;
}

function buildHolidayMap(year) {
  // 1) base holidays
  const base = buildBaseHolidays(year);

  // 2) citizen's holiday: a weekday between two holidays becomes holiday
  // 3) substitute holiday: if holiday on Sunday, next weekday becomes substitute; chain if already holiday
  // この順は、実運用上「国民の休日→振替」の方が自然（連休の扱いが安定）
  // ただし両方を反復適用して収束させる。

  const isWeekend = (dt) => {
    const dow = dt.getUTCDay(); // 0 Sun, 6 Sat
    return dow === 0 || dow === 6;
  };

  const dateToKey = (dt) => {
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    return ymd(y, m, d);
  };

  const keyToDateUTC = (key) => {
    const p = parseYmd(key);
    return new Date(Date.UTC(p.y, p.mo - 1, p.d));
  };

  const map = new Map(base);

  const inYear = (dt) => dt.getUTCFullYear() === year;

  // 祝日判定関数（名前がなくても「休日」として入ってる場合がある）
  const isHolidayKey = (key) => map.has(key);

  // 反復して収束
  for (let loop = 0; loop < 5; loop++) {
    let changed = false;

    // 国民の休日
    // 対象は年内の日付すべて
    for (let month = 1; month <= 12; month++) {
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const dt = new Date(Date.UTC(year, month - 1, day));
        const key = dateToKey(dt);

        if (isHolidayKey(key)) continue;
        if (isWeekend(dt)) continue;

        const prev = new Date(Date.UTC(year, month - 1, day - 1));
        const next = new Date(Date.UTC(year, month - 1, day + 1));
        if (!inYear(prev) || !inYear(next)) continue;

        const prevKey = dateToKey(prev);
        const nextKey = dateToKey(next);
        if (isHolidayKey(prevKey) && isHolidayKey(nextKey)) {
          map.set(key, "休日");
          changed = true;
        }
      }
    }

    // 振替休日（連鎖含む）
    for (const [key, name] of Array.from(map.entries())) {
      const dt = keyToDateUTC(key);
      if (!inYear(dt)) continue;

      const dow = dt.getUTCDay();
      if (dow !== 0) continue; // Sunday only

      // next day
      let cursor = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + 1));
      while (inYear(cursor)) {
        const cKey = dateToKey(cursor);
        const cDow = cursor.getUTCDay();
        // 振替休日は基本「平日」に当てる（ただし連鎖の途中で土曜に当たるケースを避けるため、土日は飛ばす）
        if (cDow === 0 || cDow === 6) {
          cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1));
          continue;
        }
        if (!map.has(cKey)) {
          map.set(cKey, "振替休日");
          changed = true;
        }
        break;
      }
    }

    if (!changed) break;
  }

  return map;
}

/* ----------------------------
   UI生成
---------------------------- */
const monthTabsTopInner = document.getElementById("monthTabsTopInner");
const monthTabsInners = [monthTabsTopInner].filter(Boolean);
const daysContainer = document.getElementById("daysContainer");

const todayCalendar = document.getElementById("todayCalendar");

const refreshButton = document.getElementById("refreshButton");
const settingsButton = document.getElementById("settingsButton");
const settingsDialog = document.getElementById("settingsDialog");
const yearInput = document.getElementById("yearInput");
const companyHolidayDate = document.getElementById("companyHolidayDate");
const companyHolidayName = document.getElementById("companyHolidayName");
const addCompanyHoliday = document.getElementById("addCompanyHoliday");
const companyHolidayList = document.getElementById("companyHolidayList");
const hourlyWageInput = document.getElementById("hourlyWageInput");
const saveWage = document.getElementById("saveWage");

const exportData = document.getElementById("exportData");
const importData = document.getElementById("importData");
const backupText = document.getElementById("backupText");
const reactionImageList = document.getElementById("reactionImageList");

const sumWorkDays = document.getElementById("sumWorkDays");
const sumTotalHours = document.getElementById("sumTotalHours");
const sumRegularHours = document.getElementById("sumRegularHours");
const sumOverHours = document.getElementById("sumOverHours");
const sumRegularPay = document.getElementById("sumRegularPay");
const sumOverPay = document.getElementById("sumOverPay");
const sumTotalPay = document.getElementById("sumTotalPay");
const quickMessage = document.getElementById("quickMessage");
const reactionOverlay = document.getElementById("reactionOverlay");
const reactionOverlayImage = document.getElementById("reactionOverlayImage");
const reactionOverlayText = document.getElementById("reactionOverlayText");

let quickMessageTimer = null;
let reactionOverlayTimer = null;
let reactionImageDbPromise = null;

function showQuickMessage(text, durationMs = 2000) {
  if (!quickMessage) return;
  quickMessage.textContent = text;
  quickMessage.classList.add("is-visible");
  if (quickMessageTimer) clearTimeout(quickMessageTimer);
  quickMessageTimer = window.setTimeout(() => {
    quickMessage.classList.remove("is-visible");
  }, durationMs);
}

function hideReactionOverlay() {
  if (!reactionOverlay) return;
  reactionOverlay.classList.remove("is-visible");
  if (reactionOverlayImage) {
    reactionOverlayImage.hidden = true;
    reactionOverlayImage.removeAttribute("src");
  }
  if (reactionOverlayText) {
    reactionOverlayText.hidden = true;
    reactionOverlayText.textContent = "";
  }
}

function showReactionOverlayImage(dataUrl, durationMs = 3000) {
  if (!reactionOverlay || !reactionOverlayImage || !reactionOverlayText) return;
  reactionOverlayText.hidden = true;
  reactionOverlayText.textContent = "";
  reactionOverlayImage.src = dataUrl;
  reactionOverlayImage.hidden = false;
  reactionOverlay.classList.add("is-visible");
  if (reactionOverlayTimer) clearTimeout(reactionOverlayTimer);
  reactionOverlayTimer = window.setTimeout(hideReactionOverlay, durationMs);
}

function showReactionOverlayText(text, durationMs = 3000) {
  if (!reactionOverlay || !reactionOverlayImage || !reactionOverlayText) return;
  reactionOverlayImage.hidden = true;
  reactionOverlayImage.removeAttribute("src");
  reactionOverlayText.textContent = text;
  reactionOverlayText.hidden = false;
  reactionOverlay.classList.add("is-visible");
  if (reactionOverlayTimer) clearTimeout(reactionOverlayTimer);
  reactionOverlayTimer = window.setTimeout(hideReactionOverlay, durationMs);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
  });
}

function openReactionImageDb() {
  if (reactionImageDbPromise) return reactionImageDbPromise;
  if (!("indexedDB" in window)) {
    reactionImageDbPromise = Promise.reject(new Error("IndexedDB is not available"));
    return reactionImageDbPromise;
  }

  reactionImageDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(IMAGE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        db.createObjectStore(IMAGE_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });

  return reactionImageDbPromise;
}

async function getReactionImageRecord(slotId) {
  try {
    const db = await openReactionImageDb();
    const transaction = db.transaction(IMAGE_STORE_NAME, "readonly");
    const record = await requestToPromise(transaction.objectStore(IMAGE_STORE_NAME).get(slotId));
    await transactionToPromise(transaction);
    return record || null;
  } catch {
    return null;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

async function saveReactionImageRecord(slotId, file) {
  const dataUrl = await readFileAsDataUrl(file);
  const db = await openReactionImageDb();
  const transaction = db.transaction(IMAGE_STORE_NAME, "readwrite");
  transaction.objectStore(IMAGE_STORE_NAME).put({
    id: slotId,
    dataUrl,
    fileName: file.name || "image",
    updatedAt: Date.now()
  });
  await transactionToPromise(transaction);
}

async function deleteReactionImageRecord(slotId) {
  const db = await openReactionImageDb();
  const transaction = db.transaction(IMAGE_STORE_NAME, "readwrite");
  transaction.objectStore(IMAGE_STORE_NAME).delete(slotId);
  await transactionToPromise(transaction);
}

async function showReactionForSlot(slotId) {
  const record = await getReactionImageRecord(slotId);
  if (record?.dataUrl) {
    showReactionOverlayImage(record.dataUrl, 3000);
    return;
  }
  showReactionOverlayText(DEFAULT_REACTION_TEXT[slotId] || "お疲れさまです", 3000);
}

function renderTodayCalendar() {
  if (!todayCalendar) return;

  const today = getTodayContext();
  const firstDay = new Date(Date.UTC(today.year, today.month - 1, 1));
  const firstDow = firstDay.getUTCDay();
  const daysInMonth = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();
  const prevMonthDays = new Date(Date.UTC(today.year, today.month - 1, 0)).getUTCDate();
  const totalCells = (firstDow + daysInMonth) <= 35 ? 35 : 42;
  const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
  const holidayMap = buildHolidayMap(today.year);
  const companyHolidayDates = companyHolidaySet(today.year);

  todayCalendar.innerHTML = "";

  const panel = document.createElement("div");
  panel.className = "today-calendar-panel";

  const monthLabel = document.createElement("div");
  monthLabel.className = "today-calendar-title tabnums";
  monthLabel.textContent = `${today.month}月`;
  panel.appendChild(monthLabel);

  const weekdayGrid = document.createElement("div");
  weekdayGrid.className = "today-calendar-weekdays";
  for (const [index, label] of weekdayLabels.entries()) {
    const cell = document.createElement("div");
    cell.className = "today-calendar-weekday";
    if (index === 0) cell.classList.add("is-sunholiday");
    if (index === 6) cell.classList.add("is-sat");
    cell.textContent = label;
    weekdayGrid.appendChild(cell);
  }
  panel.appendChild(weekdayGrid);

  const spacer = document.createElement("div");
  spacer.className = "today-calendar-spacer";
  spacer.setAttribute("aria-hidden", "true");
  panel.appendChild(spacer);

  const dateGrid = document.createElement("div");
  dateGrid.className = "today-calendar-grid tabnums";

  for (let index = 0; index < totalCells; index++) {
    const cell = document.createElement("div");
    cell.className = "today-calendar-date";

    const dayNumber = index - firstDow + 1;
    if (dayNumber < 1) {
      cell.textContent = String(prevMonthDays + dayNumber);
      cell.classList.add("is-outside");
    } else if (dayNumber > daysInMonth) {
      cell.textContent = String(dayNumber - daysInMonth);
      cell.classList.add("is-outside");
    } else {
      cell.textContent = String(dayNumber);
      const cellKey = ymd(today.year, today.month, dayNumber);
      const weekend = isWeekendUTC(today.year, today.month, dayNumber);
      const isHoliday = holidayMap.has(cellKey) || companyHolidayDates.has(cellKey);
      if (weekend.isSat) cell.classList.add("is-sat");
      if (weekend.isSun || isHoliday) cell.classList.add("is-sunholiday");
      if (dayNumber === today.day) {
        cell.classList.add("is-today");
      }
    }

    dateGrid.appendChild(cell);
  }

  panel.appendChild(dateGrid);
  todayCalendar.appendChild(panel);
}

function applySummaryToneClasses() {
  const workTargets = [sumWorkDays, sumTotalHours];
  const regularTargets = [sumRegularHours, sumRegularPay];
  const overtimeTargets = [sumOverHours, sumOverPay];
  const totalTargets = [sumTotalPay];

  for (const el of workTargets) {
    const item = el?.closest(".summary-item");
    if (item) item.classList.add("summary-item-work");
  }
  for (const el of regularTargets) {
    const item = el?.closest(".summary-item");
    if (item) item.classList.add("summary-item-regular");
  }
  for (const el of overtimeTargets) {
    const item = el?.closest(".summary-item");
    if (item) item.classList.add("summary-item-overtime");
  }
  for (const el of totalTargets) {
    const item = el?.closest(".summary-item");
    if (item) item.classList.add("summary-item-totalpay");
  }
}

let state = loadState();

const ui = {
  selectedYear: state.year,
  selectedMonth: nowTokyoParts().month
};

function ensureYearData(year) {
  const y = String(year);
  if (!state.yearData || typeof state.yearData !== "object") state.yearData = {};
  if (!state.yearData[y] || typeof state.yearData[y] !== "object") {
    state.yearData[y] = { companyHolidays: [], days: {} };
  }

  const yd = state.yearData[y];
  yd.companyHolidays = normalizeCompanyHolidayList(yd.companyHolidays);
  if (!yd.days || typeof yd.days !== "object") yd.days = {};
  return yd;
}

function getDayRecord(year, key) {
  const yd = ensureYearData(year);
  if (!yd.days[key]) {
    yd.days[key] = {
      in: null,
      out: null,
      category: CATEGORY.NORMAL,
      note: "",
      noteOpen: false
    };
  }
  return yd.days[key];
}

function setDayRecord(year, key, patch) {
  const rec = getDayRecord(year, key);
  Object.assign(rec, patch);
  saveState();
}

function companyHolidaySet(year) {
  const yd = ensureYearData(year);
  return new Set((yd.companyHolidays || []).map(x => x.date));
}

function companyHolidayNameMap(year) {
  const yd = ensureYearData(year);
  const map = new Map();
  for (const item of yd.companyHolidays || []) {
    map.set(item.date, item.name || DEFAULT_COMPANY_HOLIDAY_NAME);
  }
  return map;
}

function isCompanyHoliday(year, key) {
  return companyHolidaySet(year).has(key);
}

function isWeekendUTC(year, month, day) {
  const dt = new Date(Date.UTC(year, month - 1, day));
  const dow = dt.getUTCDay();
  return { isSun: dow === 0, isSat: dow === 6, dow };
}

function dateKeyFromUTC(dt) {
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function getBusinessDayKeysForMonth(year, month, holidayMap = buildHolidayMap(year), compSet = companyHolidaySet(year)) {
  const keys = [];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const key = ymd(year, month, day);
    const weekend = isWeekendUTC(year, month, day);
    if (weekend.isSun || weekend.isSat) continue;
    if (holidayMap.has(key) || compSet.has(key)) continue;
    keys.push(key);
  }
  return keys;
}

function getLastBusinessDayKeyOfWeek(dateKey) {
  const parts = parseYmd(dateKey);
  if (!parts) return null;

  const base = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d));
  const mondayOffset = (base.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d - mondayOffset));

  let lastBusinessKey = null;
  const cache = new Map();
  for (let offset = 0; offset < 5; offset++) {
    const cursor = new Date(Date.UTC(
      monday.getUTCFullYear(),
      monday.getUTCMonth(),
      monday.getUTCDate() + offset
    ));
    const year = cursor.getUTCFullYear();
    if (!cache.has(year)) {
      cache.set(year, {
        holidayMap: buildHolidayMap(year),
        compSet: companyHolidaySet(year)
      });
    }

    const key = dateKeyFromUTC(cursor);
    const weekday = cursor.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    const { holidayMap, compSet } = cache.get(year);
    if (holidayMap.has(key) || compSet.has(key)) continue;
    lastBusinessKey = key;
  }

  return lastBusinessKey;
}

function monthHasAbsence(year, month, plannedKeys) {
  return plannedKeys.some((key) => getDayRecord(year, key).category === CATEGORY.ABSENCE);
}

function getClockOutReactionSlot(year, dateKey, holidayMap, compSet) {
  const parts = parseYmd(dateKey);
  if (!parts) return REACTION_SLOT.CLOCK_OUT;

  const plannedKeys = getBusinessDayKeysForMonth(year, parts.mo, holidayMap, compSet);
  const lastBusinessDayKey = plannedKeys[plannedKeys.length - 1] || null;
  if (dateKey === lastBusinessDayKey) {
    return monthHasAbsence(year, parts.mo, plannedKeys)
      ? REACTION_SLOT.MONTH_END_WITH_ABSENCE
      : REACTION_SLOT.MONTH_END_PERFECT;
  }

  const halfIndex = Math.ceil(plannedKeys.length / 2) - 1;
  if (plannedKeys[halfIndex] === dateKey) {
    return REACTION_SLOT.HALF_MONTH;
  }

  if (getLastBusinessDayKeyOfWeek(dateKey) === dateKey) {
    return REACTION_SLOT.WEEK_END;
  }

  return REACTION_SLOT.CLOCK_OUT;
}

function renderMonthTabs() {
  for (const inner of monthTabsInners) {
    inner.innerHTML = "";
    for (let m = 1; m <= 12; m++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "month-tab" + (m === ui.selectedMonth ? " is-active" : "");
      btn.textContent = `${m}月`;
      btn.dataset.month = String(m);
      btn.addEventListener("click", () => {
        ui.selectedMonth = m;
        renderAll();
        scrollAllMonthTabsToActive();
      });
      inner.appendChild(btn);
    }
  }
}

function scrollSelectedTabToLeft(inner, behavior = "smooth") {
  const active = inner?.querySelector(".month-tab.is-active");
  if (!active) return;
  const scrollParent = inner.parentElement;
  const left = active.offsetLeft;
  scrollParent.scrollTo({ left, behavior });
}

function scrollAllMonthTabsToActive(behavior = "smooth") {
  for (const inner of monthTabsInners) {
    scrollSelectedTabToLeft(inner, behavior);
  }
}

function scrollToDateCard(dateKey, behavior = "smooth") {
  const target = daysContainer.querySelector(`[data-date-key="${dateKey}"]`);
  if (!target) return false;
  target.scrollIntoView({ behavior, block: "start" });
  return true;
}

function jumpToToday(behavior = "smooth") {
  const today = getTodayContext();
  ensureYearData(today.year);
  ui.selectedYear = today.year;
  ui.selectedMonth = today.month;
  state.year = today.year;
  saveState();
  renderMonthTabs();
  renderAll();
  scrollAllMonthTabsToActive(behavior);
  window.requestAnimationFrame(() => {
    scrollToDateCard(today.key, behavior);
  });
}

function svgSparklesCircle(isSelected) {
  const fill = isSelected ? "var(--green-selected)" : "var(--green-normal)";
  const stroke = isSelected ? "rgba(15, 76, 51, 0.65)" : "rgba(31, 138, 91, 0.25)";
  const sparkle = isSelected ? "#fff1a8" : "#ffffff";
  return `
    <svg viewBox="0 0 64 64" width="24" height="24" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="18" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      <path d="M32 10c1.2 6.2 3.2 8.2 9.4 9.4c-6.2 1.2-8.2 3.2-9.4 9.4c-1.2-6.2-3.2-8.2-9.4-9.4c6.2-1.2 8.2-3.2 9.4-9.4z"
            fill="${sparkle}" opacity="0.95"/>
      <path d="M48 26c.9 4.4 2.3 5.8 6.7 6.7c-4.4.9-5.8 2.3-6.7 6.7c-.9-4.4-2.3-5.8-6.7-6.7c4.4-.9 5.8-2.3 6.7-6.7z"
            fill="#ffd36e" opacity="0.92"/>
      <path d="M17 30c.7 3.4 1.8 4.5 5.2 5.2c-3.4.7-4.5 1.8-5.2 5.2c-.7-3.4-1.8-4.5-5.2-5.2c3.4-.7 4.5-1.8 5.2-5.2z"
            fill="#ffd36e" opacity="0.88"/>
    </svg>
  `;
}

function svgMemoIcon() {
  return `
    <svg viewBox="0 0 64 64" width="24" height="24" aria-hidden="true" focusable="false">
      <path d="M18 10h22l6 6v34a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z" fill="#ffffff" stroke="rgba(255,127,183,0.55)" stroke-width="2"/>
      <path d="M40 10v10h10" fill="none" stroke="rgba(255,127,183,0.55)" stroke-width="2" stroke-linejoin="round"/>
      <path d="M22 28h20M22 36h16M22 44h18" stroke="rgba(31,41,55,0.55)" stroke-width="2" stroke-linecap="round"/>
      <path d="M50 8c.9 3.6 1.8 4.5 5.4 5.4c-3.6.9-4.5 1.8-5.4 5.4c-.9-3.6-1.8-4.5-5.4-5.4c3.6-.9 4.5-1.8 5.4-5.4z" fill="#ffd36e" opacity="0.95"/>
    </svg>
  `;
}

function computeDayMetrics(year, key, holidayMap, companyHolidaySetForYear, companyHolidayNameMapForYear) {
  const rec = getDayRecord(year, key);
  const p = parseYmd(key);
  const { isSun, isSat } = isWeekendUTC(p.y, p.mo, p.d);

  const isNatHoliday = holidayMap.has(key);
  const isCompHoliday = companyHolidaySetForYear.has(key);
  const natHolidayName = holidayMap.get(key) || "";
  const compHolidayName = companyHolidayNameMapForYear.get(key) || "";
  const holidayName = (natHolidayName && compHolidayName && natHolidayName !== compHolidayName)
    ? `${natHolidayName} / ${compHolidayName}`
    : (natHolidayName || compHolidayName || "");
  const isOffDay = isNatHoliday || isCompHoliday || isSun || isSat;
  const isHolidayLike = isOffDay; // 日曜は休日扱い
  const isSunOrHoliday = isSun || isNatHoliday || isCompHoliday;

  const category = rec.category || CATEGORY.NORMAL;
  const isAbsent = category === CATEGORY.ABSENCE;

  // 出退勤の表示可否
  // - 有給: 非表示
  // - 土日祝/会社休日: 原則非表示。ただし「休日出勤」なら手入力（ボタン+入力）可
  // - 平日通常: 表示（ボタンで 9:30 / 18:30 自動入力）
  const allowTimeArea =
    category !== CATEGORY.PAID_LEAVE &&
    category !== CATEGORY.ABSENCE &&
    (!isHolidayLike || category === CATEGORY.HOLIDAY_WORK);

  const showButtons =
    allowTimeArea;

  const isHolidayWork = category === CATEGORY.HOLIDAY_WORK;

  // 実働計算
  let workMinutes = 0;
  let hasWorkRecord = false;

  if (category === CATEGORY.PAID_LEAVE) {
    workMinutes = 8 * 60;
    hasWorkRecord = true;
  } else if (isAbsent) {
    workMinutes = 0;
    hasWorkRecord = false;
  } else {
    const inMin = minutesFromHHMM(rec.in);
    const outMin = minutesFromHHMM(rec.out);
    if (inMin != null && outMin != null) {
      const raw = outMin - inMin - 60; // 休憩1時間固定控除
      workMinutes = Math.max(0, raw);
      hasWorkRecord = true;
    } else {
      workMinutes = 0;
      hasWorkRecord = false;
    }
  }

  // 判定
  // - 休日出勤日は判定表示なし
  // - 初期空欄、入力（ボタン押下 or 時刻入力）後に表示
  const judgeLines = [];
  let judgeType = null; // "blue" or "red" or null

  if (!isHolidayWork && category !== CATEGORY.PAID_LEAVE && category !== CATEGORY.ABSENCE) {
    const inMin = minutesFromHHMM(rec.in);
    const outMin = minutesFromHHMM(rec.out);
    const hasAny = (inMin != null) || (outMin != null);

    if (hasAny) {
      const baseIn = 9 * 60 + 30;
      const baseOut = 18 * 60 + 30;

      if (inMin != null) {
        if (inMin > baseIn) judgeLines.push("遅刻");
        if (inMin < baseIn) judgeLines.push("早出");
      }
      if (outMin != null) {
        if (outMin < baseOut) judgeLines.push("早退");
        if (outMin > baseOut) judgeLines.push("残業");
      }

      if (judgeLines.length === 0) {
        judgeLines.push("定時");
      }

      if (judgeLines.includes("定時") && judgeLines.length === 1) {
        judgeType = "blue";
      } else if (judgeLines.some(x => x === "遅刻" || x === "早退" || x === "残業")) {
        judgeType = "red";
      } else {
        // 早出のみ等
        judgeType = "blue";
      }
    }
  } else {
    // 休日出勤は判定表示なし（空）
  }

  // 給与
  const wage = state.hourlyWage;
  const hours = workMinutes / 60;

  let regularHours = 0;
  let overtimePremiumHours = 0; // 割増対象時間
  let regularPay = 0;
  let overtimePayExtra = 0; // overtime pay (incl. premium)
  let totalPay = 0;

  if (category === CATEGORY.PAID_LEAVE) {
    regularHours = 8.0;
    overtimePremiumHours = 0;
    regularPay = Math.round(regularHours * wage);
    overtimePayExtra = 0;
    totalPay = regularPay;
  } else if (category === CATEGORY.ABSENCE) {
    regularHours = 0;
    overtimePremiumHours = 0;
    regularPay = 0;
    overtimePayExtra = 0;
    totalPay = 0;
  } else if (isHolidayWork) {
    // 休日出勤: 全時間 1.25倍
    regularHours = 0;
    overtimePremiumHours = hours;
    overtimePayExtra = Math.round(hours * wage * 1.25);
    totalPay = overtimePayExtra;
    regularPay = 0;
  } else {
    // 平日通常
    regularHours = Math.min(8, hours);
    const over = Math.max(0, hours - 8);
    overtimePremiumHours = over;
    regularPay = Math.round(regularHours * wage);
    overtimePayExtra = Math.round(over * wage * 1.25);
    totalPay = regularPay + overtimePayExtra;
  }

  const workedText = (category === CATEGORY.PAID_LEAVE)
    ? "8.0h"
    : (
      isAbsent
        ? "欠勤"
        : (
          hasWorkRecord
            ? `${(Math.round(hours * 10) / 10).toFixed(1)}h`
            : ((isOffDay && !isHolidayWork) ? "\u4f11\u65e5" : "-")
        )
    );

  return {
    isSat,
    isOffDay,
    isSunOrHoliday,
    isNatHoliday,
    isCompHoliday,
    holidayName,
    allowTimeArea,
    showButtons,
    isHolidayWork,
    category,
    judgeLines,
    judgeType,
    workMinutes,
    workedText,
    regularHours,
    overtimePremiumHours,
    regularPay,
    overtimePayExtra,
    totalPay,
    hasWorkRecord,
    isAbsent
  };
}

function createCategoryMenu(onSelect) {
  const menu = document.createElement("div");
  menu.className = "category-menu";
  // menuはDOMに直接出さず、confirm風に実装（iOSで確実）
  // なのでここでは使わない
  void onSelect;
  void menu;
}

function chooseCategory(current) {
  // iOS Safariでも動くシンプルな選択
  const options = [
    { value: CATEGORY.PAID_LEAVE, label: "有給" },
    { value: CATEGORY.HOLIDAY_WORK, label: "休日出勤" },
    { value: CATEGORY.ABSENCE, label: "欠勤" },
    { value: CATEGORY.NORMAL, label: "通常に戻す" }
  ];
  const labelMap = new Map(options.map(o => [o.value, o.label]));
  const currentLabel = labelMap.get(current) || "通常に戻す";
  const promptText =
    "勤怠区分を選択:\n" +
    "1: 有給\n" +
    "2: 休日出勤\n" +
    "3: 欠勤\n" +
    "4: 通常に戻す\n\n" +
    `現在: ${currentLabel}`;

  const ans = window.prompt(promptText, "4");
  if (ans == null) return null;
  const trimmed = ans.trim();
  if (trimmed === "1") return CATEGORY.PAID_LEAVE;
  if (trimmed === "2") return CATEGORY.HOLIDAY_WORK;
  if (trimmed === "3") return CATEGORY.ABSENCE;
  if (trimmed === "4") return CATEGORY.NORMAL;
  return null;
}

function renderDays() {
  const year = ui.selectedYear;
  const month = ui.selectedMonth;

  const holidayMap = buildHolidayMap(year);
  const compSet = companyHolidaySet(year);
  const compNameMap = companyHolidayNameMap(year);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  daysContainer.innerHTML = "";

  for (let day = 1; day <= daysInMonth; day++) {
    const key = ymd(year, month, day);
    const rec = getDayRecord(year, key);
    const metrics = computeDayMetrics(year, key, holidayMap, compSet, compNameMap);

    const { datePart, holidayName } = formatDateLine(year, month, day, metrics.holidayName);

    const card = document.createElement("div");
    card.className = "day-card";
    card.dataset.dateKey = key;
    if (metrics.isSat) card.classList.add("is-sat");
    if (metrics.isSunOrHoliday) card.classList.add("is-sunholiday");

    const rowTop = document.createElement("div");
    rowTop.className = "day-row day-row-top";

    const dateCell = document.createElement("div");
    dateCell.className = "cell";

    const dateLine = document.createElement("div");
    dateLine.className = "date-line";

    const dateText = document.createElement("div");
    dateText.className = "date-text tabnums";
    dateText.textContent = datePart;

    const dateMain = document.createElement("div");
    dateMain.className = "date-main";
    dateMain.appendChild(dateText);

    const judgeInline = document.createElement("div");
    judgeInline.className = "judge-inline";
    if (metrics.judgeLines.length > 0 && metrics.judgeType) {
      for (const line of metrics.judgeLines) {
        const b = document.createElement("div");
        b.className = `badge ${metrics.judgeType}`;
        b.textContent = line;
        judgeInline.appendChild(b);
      }
    }
    dateMain.appendChild(judgeInline);
    dateLine.appendChild(dateMain);

    if (holidayName) {
      const hn = document.createElement("div");
      hn.className = "holiday-name";
      hn.textContent = holidayName;
      dateLine.appendChild(hn);
    }

    dateCell.appendChild(dateLine);

    const workedCell = document.createElement("div");
    workedCell.className = "cell worked-area";

    const worked = document.createElement("div");
    worked.className = "worked-hours tabnums";
    worked.textContent = metrics.workedText;
    if (metrics.isAbsent) worked.classList.add("is-absence");

    workedCell.appendChild(worked);

    const iconsCell = document.createElement("div");
    iconsCell.className = "cell icons-area";

    const catBtn = document.createElement("button");
    catBtn.type = "button";
    catBtn.className = "icon-mini category";
    const catSelected = (metrics.category !== CATEGORY.NORMAL);
    if (catSelected) catBtn.classList.add("is-selected");
    catBtn.innerHTML = svgSparklesCircle(catSelected);
    catBtn.setAttribute("aria-label", "\u52e4\u6020\u533a\u5206\u9078\u629e");

    catBtn.addEventListener("click", () => {
      const chosen = chooseCategory(rec.category || CATEGORY.NORMAL);
      if (!chosen) return;

      if (chosen === CATEGORY.PAID_LEAVE) {
        setDayRecord(year, key, { category: chosen, in: null, out: null });
      } else if (chosen === CATEGORY.ABSENCE) {
        setDayRecord(year, key, { category: chosen, in: null, out: null });
      } else if (chosen === CATEGORY.NORMAL) {
        setDayRecord(year, key, { category: chosen });
      } else if (chosen === CATEGORY.HOLIDAY_WORK) {
        setDayRecord(year, key, { category: chosen });
      }
      renderAll();
    });

    const memoBtn = document.createElement("button");
    memoBtn.type = "button";
    memoBtn.className = "icon-mini memo";
    memoBtn.innerHTML = svgMemoIcon();
    memoBtn.setAttribute("aria-label", "\u30e1\u30e2");

    if (rec.noteOpen) memoBtn.classList.add("is-open");

    memoBtn.addEventListener("click", () => {
      setDayRecord(year, key, { noteOpen: !rec.noteOpen });
      renderAll();
    });

    iconsCell.appendChild(catBtn);
    iconsCell.appendChild(memoBtn);

    rowTop.appendChild(dateCell);
    rowTop.appendChild(workedCell);
    rowTop.appendChild(iconsCell);
    card.appendChild(rowTop);

    const rowTime = document.createElement("div");
    rowTime.className = "day-row-time";

    const timeCell = document.createElement("div");
    timeCell.className = "cell time-area";

    if (metrics.allowTimeArea) {
      const inBtn = document.createElement("button");
      inBtn.type = "button";
      inBtn.className = "time-btn";
      inBtn.textContent = metrics.isHolidayWork && metrics.isOffDay
        ? "\u51fa\u52e4(\u4f11\u65e5)"
        : "\u51fa\u52e4";

      const inInput = document.createElement("input");
      inInput.type = "time";
      inInput.step = "60";
      inInput.className = "time-input tabnums";
      inInput.value = rec.in || "";

      const outBtn = document.createElement("button");
      outBtn.type = "button";
      outBtn.className = "time-btn";
      outBtn.textContent = "\u9000\u52e4";

      const outInput = document.createElement("input");
      outInput.type = "time";
      outInput.step = "60";
      outInput.className = "time-input tabnums";
      outInput.value = rec.out || "";

      const setInAuto = async () => {
        if (metrics.isHolidayWork) {
          setDayRecord(year, key, { in: roundToMinuteHHMM() });
        } else {
          setDayRecord(year, key, { in: "09:30" });
        }
        renderAll();
        await showReactionForSlot(REACTION_SLOT.CLOCK_IN);
      };

      const setOutAuto = async () => {
        if (metrics.isHolidayWork) {
          setDayRecord(year, key, { out: roundToMinuteHHMM() });
        } else {
          setDayRecord(year, key, { out: "18:30" });
        }
        renderAll();
        const slotId = getClockOutReactionSlot(year, key, holidayMap, compSet);
        await showReactionForSlot(slotId);
      };

      inBtn.addEventListener("click", setInAuto);
      outBtn.addEventListener("click", setOutAuto);

      // iOS time pickerの操作中に再描画すると、ピッカーが閉じやすいので
      // 入力中は状態保存＋集計更新のみを行い、フォーカス離脱時に再描画する。
      const onTimeManualChange = (patch) => {
        setDayRecord(year, key, patch);
        computeMonthlySummary();
      };

      inInput.addEventListener("input", () => {
        onTimeManualChange({ in: inInput.value || null });
      });

      outInput.addEventListener("input", () => {
        onTimeManualChange({ out: outInput.value || null });
      });

      inInput.addEventListener("blur", () => {
        renderAll();
      });

      outInput.addEventListener("blur", () => {
        renderAll();
      });

      const shouldHideButtonsOnHoliday =
        metrics.isOffDay &&
        !metrics.isHolidayWork;

      const shouldHideAllTimes =
        metrics.isOffDay &&
        !metrics.isHolidayWork;

      if (!shouldHideAllTimes) {
        const line = document.createElement("div");
        line.className = "time-line time-line-pair";

        if (!shouldHideButtonsOnHoliday) line.appendChild(inBtn);
        line.appendChild(inInput);
        if (!shouldHideButtonsOnHoliday) line.appendChild(outBtn);
        line.appendChild(outInput);

        timeCell.appendChild(line);
      }
    }

    if (timeCell.childElementCount > 0) {
      rowTime.appendChild(timeCell);
      card.appendChild(rowTime);
    }

    const noteArea = document.createElement("div");
    noteArea.className = "note-area" + (rec.noteOpen ? " is-open" : "");

    const noteInput = document.createElement("textarea");
    noteInput.className = "note-input";
    noteInput.rows = 2;
    noteInput.value = rec.note || "";
    noteInput.placeholder = "";

    noteInput.addEventListener("input", () => {
      setDayRecord(year, key, { note: noteInput.value });
      saveState();
    });

    noteArea.appendChild(noteInput);
    card.appendChild(noteArea);

    daysContainer.appendChild(card);
  }
}

function computeMonthlySummary() {
  const year = ui.selectedYear;
  const month = ui.selectedMonth;

  const holidayMap = buildHolidayMap(year);
  const compSet = companyHolidaySet(year);
  const compNameMap = companyHolidayNameMap(year);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  // 予定稼働日数: 土日祝・会社休日を除く
  let planned = 0;

  // 実働日数: 出勤記録がある日 + 有給日
  let workedDays = 0;

  let totalMinutes = 0;
  let regularHoursSum = 0;
  let overtimePremiumHoursSum = 0;
  let regularPaySum = 0;
  let overtimePayExtraSum = 0;
  let totalPaySum = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const key = ymd(year, month, day);
    const rec = getDayRecord(year, key);

    const m = computeDayMetrics(year, key, holidayMap, compSet, compNameMap);

    // planned
    const w = isWeekendUTC(year, month, day);
    const isNatHoliday = holidayMap.has(key);
    const isCompHoliday = compSet.has(key);
    const isHolidayLike = w.isSun || w.isSat || isNatHoliday || isCompHoliday;
    if (!isHolidayLike) planned++;

    // workedDays
    if (rec.category === CATEGORY.PAID_LEAVE) {
      workedDays++;
    } else {
      const inMin = minutesFromHHMM(rec.in);
      const outMin = minutesFromHHMM(rec.out);
      if (inMin != null && outMin != null) workedDays++;
    }

    totalMinutes += m.workMinutes;

    regularHoursSum += m.regularHours;
    overtimePremiumHoursSum += m.overtimePremiumHours;

    regularPaySum += m.regularPay;
    overtimePayExtraSum += m.overtimePayExtra;
    totalPaySum += m.totalPay;
  }

  const totalHours = totalMinutes / 60;
  const totalHoursText = `${(Math.round(totalHours * 10) / 10).toFixed(1)}h`;
  const regularHoursText = `${(Math.round(regularHoursSum * 10) / 10).toFixed(1)}h`;
  const overtimeHoursText = `${(Math.round(overtimePremiumHoursSum * 10) / 10).toFixed(1)}h`;

  sumWorkDays.textContent = `${workedDays}日/${planned}日`;
  sumTotalHours.textContent = totalHoursText;
  sumRegularHours.textContent = regularHoursText;
  sumOverHours.textContent = overtimeHoursText;

  sumRegularPay.textContent = `${Math.round(regularPaySum).toLocaleString(LOCALE)}円`;
  sumOverPay.textContent = `${Math.round(overtimePayExtraSum).toLocaleString(LOCALE)}円`;
  sumTotalPay.textContent = `${Math.round(totalPaySum).toLocaleString(LOCALE)}円`;
}

function renderAll() {
  // month tabs active update
  for (const inner of monthTabsInners) {
    const tabs = inner.querySelectorAll(".month-tab");
    tabs.forEach(btn => {
      const m = Number(btn.dataset.month);
      btn.classList.toggle("is-active", m === ui.selectedMonth);
    });
  }

  computeMonthlySummary();
  renderDays();
}

/* ----------------------------
   設定
---------------------------- */
function openSettings() {
  yearInput.value = String(ui.selectedYear);
  hourlyWageInput.value = String(state.hourlyWage);
  companyHolidayDate.value = "";
  if (companyHolidayName) companyHolidayName.value = "";

  const yd = ensureYearData(ui.selectedYear);
  companyHolidayList.innerHTML = "";
  for (const item of yd.companyHolidays) {
    companyHolidayList.appendChild(renderCompanyHolidayItem(ui.selectedYear, item));
  }
  if (!settingsDialog.open) settingsDialog.showModal();
  void renderReactionImageSettings();
}

async function renderReactionImageSettings() {
  if (!reactionImageList) return;

  reactionImageList.innerHTML = "";
  for (const slot of REACTION_IMAGE_SLOTS) {
    const record = await getReactionImageRecord(slot.id);

    const row = document.createElement("div");
    row.className = "reaction-image-item";

    const preview = document.createElement("div");
    preview.className = "reaction-image-preview";
    if (record?.dataUrl) {
      const img = document.createElement("img");
      img.src = record.dataUrl;
      img.alt = slot.label;
      preview.appendChild(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "reaction-image-placeholder";
      placeholder.textContent = "未設定";
      preview.appendChild(placeholder);
    }

    const body = document.createElement("div");
    body.className = "reaction-image-body";

    const title = document.createElement("div");
    title.className = "reaction-image-title";
    title.textContent = slot.label;

    const meta = document.createElement("div");
    meta.className = "reaction-image-meta";
    if (record?.dataUrl) {
      meta.textContent = `${record.fileName || "image"} / ${formatDateTimeLabel(record.updatedAt)}`;
    } else {
      meta.textContent = "画像を選ぶと、この端末からあとで差し替えできます。";
    }

    const actions = document.createElement("div");
    actions.className = "reaction-image-actions";

    const chooseButton = document.createElement("button");
    chooseButton.type = "button";
    chooseButton.className = "btn subtle";
    chooseButton.textContent = record?.dataUrl ? "差し替え" : "画像を選ぶ";

    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/*";

    chooseButton.addEventListener("click", () => {
      picker.click();
    });

    picker.addEventListener("change", async () => {
      const file = picker.files?.[0];
      picker.value = "";
      if (!file) return;
      chooseButton.disabled = true;
      try {
        await saveReactionImageRecord(slot.id, file);
        await renderReactionImageSettings();
      } catch {
        window.alert("画像の保存に失敗しました。");
      } finally {
        chooseButton.disabled = false;
      }
    });

    actions.appendChild(chooseButton);
    actions.appendChild(picker);

    if (record?.dataUrl) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-btn";
      deleteButton.textContent = "削除";
      deleteButton.addEventListener("click", async () => {
        try {
          await deleteReactionImageRecord(slot.id);
          await renderReactionImageSettings();
        } catch {
          window.alert("画像の削除に失敗しました。");
        }
      });
      actions.appendChild(deleteButton);
    }

    body.appendChild(title);
    body.appendChild(meta);
    body.appendChild(actions);
    row.appendChild(preview);
    row.appendChild(body);
    reactionImageList.appendChild(row);
  }
}

function renderCompanyHolidayItem(year, holidayItem) {
  const row = document.createElement("div");
  row.className = "company-holiday-item";

  const text = document.createElement("div");
  text.className = "company-holiday-text tabnums";
  const holidayLabel = holidayItem.name || DEFAULT_COMPANY_HOLIDAY_NAME;
  text.textContent = `${holidayItem.date}（${holidayLabel}）`;

  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete-btn";
  del.textContent = "削除";
  del.addEventListener("click", () => {
    const yd = ensureYearData(year);
    yd.companyHolidays = (yd.companyHolidays || []).filter(x => x.date !== holidayItem.date);
    saveState();
    openSettings(); // 再描画
    renderAll();
  });

  row.appendChild(text);
  row.appendChild(del);
  return row;
}

settingsButton.addEventListener("click", openSettings);
if (todayCalendar) {
  todayCalendar.addEventListener("click", () => {
    jumpToToday("smooth");
  });
}
if (refreshButton) refreshButton.addEventListener("click", refreshToLatest);

addCompanyHoliday.addEventListener("click", () => {
  const v = companyHolidayDate.value;
  const holidayName = normalizeCompanyHolidayName(companyHolidayName?.value || "");
  if (!v) return;

  const p = parseYmd(v);
  if (!p) return;
  if (p.y !== ui.selectedYear) {
    // 会社休日は単年管理のため、選択年と一致しない場合は追加しない
    window.alert("対象年と同じ年の日付を選択してください。");
    return;
  }

  const yd = ensureYearData(ui.selectedYear);
  const map = new Map((yd.companyHolidays || []).map(x => [x.date, x.name || ""]));
  map.set(v, holidayName);
  yd.companyHolidays = Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, name]) => ({ date, name }));
  saveState();

  openSettings();
  renderAll();
});

saveWage.addEventListener("click", () => {
  const v = Number(hourlyWageInput.value);
  if (!Number.isFinite(v) || v < 0) return;
  state.hourlyWage = Math.round(v);
  saveState();
  renderAll();
});

yearInput.addEventListener("change", () => {
  const v = Number(yearInput.value);
  if (!Number.isFinite(v)) return;
  const y = Math.max(2000, Math.min(2099, Math.floor(v)));
  ui.selectedYear = y;
  state.year = y;
  ensureYearData(y);
  saveState();
  // 設定画面内も再描画
  openSettings();
  renderMonthTabs();
  renderAll();
  scrollAllMonthTabsToActive();
});

exportData.addEventListener("click", () => {
  // 機密情報は含まない（localのみ）。復元用文字列。
  const payload = {
    version: 1,
    data: state
  };
  backupText.value = JSON.stringify(payload);
  backupText.focus();
  backupText.select();
});

importData.addEventListener("click", () => {
  const txt = backupText.value.trim();
  if (!txt) return;
  try {
    const parsed = JSON.parse(txt);
    if (!parsed || parsed.version !== 1 || !parsed.data) {
      window.alert("形式が違います。");
      return;
    }
    const d = parsed.data;
    // 最小検証
    if (typeof d.hourlyWage !== "number" || typeof d.year !== "number" || typeof d.yearData !== "object") {
      window.alert("形式が違います。");
      return;
    }
    state = d;
    saveState();

    ui.selectedYear = state.year;
    ui.selectedMonth = ui.selectedMonth || 1;

    renderMonthTabs();
    renderAll();
    scrollAllMonthTabsToActive();
    window.alert("復元しました。");
  } catch {
    window.alert("復元に失敗しました。");
  }
});

/* ----------------------------
   PWA: service worker
---------------------------- */
async function clearServiceWorkerAndCaches() {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(reg => reg.unregister()));
  }

  if ("caches" in window) {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map(key => caches.delete(key)));
  }
}

function handleHardReloadStep() {
  const step = sessionStorage.getItem(HARD_RELOAD_STEP_KEY);
  if (step === "1") {
    sessionStorage.setItem(HARD_RELOAD_STEP_KEY, "2");
    window.location.reload();
    return true;
  }
  if (step === "2") {
    sessionStorage.removeItem(HARD_RELOAD_STEP_KEY);
  }
  return false;
}

async function refreshToLatest() {
  const confirmed = window.confirm("キャッシュを削除して最新版を読み込みます。データは消えません");
  if (!confirmed) return;

  if (refreshButton) refreshButton.disabled = true;
  try {
    await clearServiceWorkerAndCaches();
    window.alert("キャッシュ削除が完了しました。最新版を再読み込みします。");
    sessionStorage.setItem(HARD_RELOAD_STEP_KEY, "1");
    window.location.reload();
  } catch {
    if (refreshButton) refreshButton.disabled = false;
    window.alert("キャッシュ削除に失敗しました。通信状態を確認して再度お試しください。");
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
  } catch {
    // 失敗しても画面には何も出さない（要件）
  }
}

/* ----------------------------
   初期化
---------------------------- */
function init() {
  if (handleHardReloadStep()) return;

  const today = getTodayContext();
  ensureYearData(today.year);
  state.year = today.year;
  saveState();
  ui.selectedYear = today.year;
  ui.selectedMonth = today.month;
  applySummaryToneClasses();
  renderTodayCalendar();

  renderMonthTabs();
  renderAll();
  scrollAllMonthTabsToActive("auto");
  window.requestAnimationFrame(() => {
    scrollToDateCard(today.key, "auto");
  });

  registerServiceWorker();
}

init();
