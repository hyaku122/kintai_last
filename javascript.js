"use strict";

/*
  タイムゾーン固定: Asia/Tokyo
  表示ロケール: ja-JP
*/
const TZ = "Asia/Tokyo";
const LOCALE = "ja-JP";

const STORAGE_KEY = "kintai_pwa_v1";

const DEFAULTS = {
  hourlyWage: 1500,
  year: null,
  // yearData[YYYY] = { companyHolidays: ["YYYY-MM-DD",...], days: { "YYYY-MM-DD": { in:"HH:MM"|null, out:"HH:MM"|null, category:"normal"|"paid_leave"|"holiday_work", note:"", noteOpen:boolean } } }
  yearData: {}
};

const CATEGORY = {
  NORMAL: "normal",
  PAID_LEAVE: "paid_leave",
  HOLIDAY_WORK: "holiday_work"
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
const monthTabsInner = document.getElementById("monthTabsInner");
const daysContainer = document.getElementById("daysContainer");

const settingsButton = document.getElementById("settingsButton");
const settingsDialog = document.getElementById("settingsDialog");
const yearInput = document.getElementById("yearInput");
const companyHolidayDate = document.getElementById("companyHolidayDate");
const addCompanyHoliday = document.getElementById("addCompanyHoliday");
const companyHolidayList = document.getElementById("companyHolidayList");
const hourlyWageInput = document.getElementById("hourlyWageInput");
const saveWage = document.getElementById("saveWage");

const exportData = document.getElementById("exportData");
const importData = document.getElementById("importData");
const backupText = document.getElementById("backupText");

const sumWorkDays = document.getElementById("sumWorkDays");
const sumTotalHours = document.getElementById("sumTotalHours");
const sumRegularHours = document.getElementById("sumRegularHours");
const sumOverHours = document.getElementById("sumOverHours");
const sumRegularPay = document.getElementById("sumRegularPay");
const sumOverPay = document.getElementById("sumOverPay");
const sumTotalPay = document.getElementById("sumTotalPay");

function applySummaryToneClasses() {
  const regularTargets = [sumRegularHours, sumRegularPay];
  const overtimeTargets = [sumOverHours, sumOverPay];

  for (const el of regularTargets) {
    const item = el?.closest(".summary-item");
    if (item) item.classList.add("summary-item-regular");
  }
  for (const el of overtimeTargets) {
    const item = el?.closest(".summary-item");
    if (item) item.classList.add("summary-item-overtime");
  }
}

let state = loadState();

const ui = {
  selectedYear: state.year,
  selectedMonth: nowTokyoParts().month
};

function ensureYearData(year) {
  const y = String(year);
  if (!state.yearData[y]) state.yearData[y] = { companyHolidays: [], days: {} };
  return state.yearData[y];
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
  return new Set(yd.companyHolidays || []);
}

function isCompanyHoliday(year, key) {
  return companyHolidaySet(year).has(key);
}

function isWeekendUTC(year, month, day) {
  const dt = new Date(Date.UTC(year, month - 1, day));
  const dow = dt.getUTCDay();
  return { isSun: dow === 0, isSat: dow === 6, dow };
}

function renderMonthTabs() {
  monthTabsInner.innerHTML = "";
  for (let m = 1; m <= 12; m++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "month-tab" + (m === ui.selectedMonth ? " is-active" : "");
    btn.textContent = `${m}月`;
    btn.dataset.month = String(m);
    btn.addEventListener("click", () => {
      ui.selectedMonth = m;
      renderAll();
      scrollSelectedTabToLeft();
    });
    monthTabsInner.appendChild(btn);
  }
}

function scrollSelectedTabToLeft() {
  const active = monthTabsInner.querySelector(".month-tab.is-active");
  if (!active) return;
  const scrollParent = monthTabsInner.parentElement;
  const left = active.offsetLeft;
  scrollParent.scrollTo({ left, behavior: "smooth" });
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

function computeDayMetrics(year, key, holidayMap, companyHolidaySetForYear) {
  const rec = getDayRecord(year, key);
  const p = parseYmd(key);
  const { isSun, isSat } = isWeekendUTC(p.y, p.mo, p.d);

  const isNatHoliday = holidayMap.has(key);
  const isCompHoliday = companyHolidaySetForYear.has(key);
  const isOffDay = isNatHoliday || isCompHoliday || isSun || isSat;
  const isHolidayLike = isOffDay; // 日曜は休日扱い
  const isSunOrHoliday = isSun || isNatHoliday || isCompHoliday;

  const category = rec.category || CATEGORY.NORMAL;

  // 出退勤の表示可否
  // - 有給: 非表示
  // - 土日祝/会社休日: 原則非表示。ただし「休日出勤」なら手入力（ボタン+入力）可
  // - 平日通常: 表示（ボタンで 9:30 / 18:30 自動入力）
  const allowTimeArea =
    category !== CATEGORY.PAID_LEAVE &&
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

  if (!isHolidayWork && category !== CATEGORY.PAID_LEAVE) {
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
  let overtimePayExtra = 0; // 0.25分（割増分）
  let totalPay = 0;

  if (category === CATEGORY.PAID_LEAVE) {
    regularHours = 8.0;
    overtimePremiumHours = 0;
    regularPay = Math.round(regularHours * wage);
    overtimePayExtra = 0;
    totalPay = regularPay;
  } else if (isHolidayWork) {
    // 休日出勤: 全時間 1.25倍
    regularHours = 0;
    overtimePremiumHours = hours; // 割増対象時間として残業時間に集計
    const base = hours * wage;
    overtimePayExtra = Math.round(base * 0.25); // 0.25分（割増分）
    totalPay = Math.round(base + base * 0.25);
    regularPay = Math.round(base); // 内訳として定時給に相当するベースも持つが、表示上は定時給料に合算するためここに入れる
  } else {
    // 平日通常
    regularHours = Math.min(8, hours);
    const over = Math.max(0, hours - 8);
    overtimePremiumHours = over;
    regularPay = Math.round(regularHours * wage);
    overtimePayExtra = Math.round(over * wage * 0.25);
    totalPay = Math.round(hours * wage + over * wage * 0.25);
  }

  const workedText = (category === CATEGORY.PAID_LEAVE)
    ? "8.0h"
    : (
      hasWorkRecord
        ? `${(Math.round(hours * 10) / 10).toFixed(1)}h`
        : ((isOffDay && !isHolidayWork) ? "\u4f11\u65e5" : "-")
    );

  return {
    isSat,
    isOffDay,
    isSunOrHoliday,
    isNatHoliday,
    isCompHoliday,
    holidayName: holidayMap.get(key) || "",
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
    hasWorkRecord
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
    { value: CATEGORY.NORMAL, label: "通常に戻す" }
  ];
  const labelMap = new Map(options.map(o => [o.value, o.label]));
  const currentLabel = labelMap.get(current) || "通常に戻す";
  const promptText =
    "勤怠区分を選択:\n" +
    "1: 有給\n" +
    "2: 休日出勤\n" +
    "3: 通常に戻す\n\n" +
    `現在: ${currentLabel}`;

  const ans = window.prompt(promptText, "3");
  if (ans == null) return null;
  const trimmed = ans.trim();
  if (trimmed === "1") return CATEGORY.PAID_LEAVE;
  if (trimmed === "2") return CATEGORY.HOLIDAY_WORK;
  if (trimmed === "3") return CATEGORY.NORMAL;
  return null;
}

function renderDays() {
  const year = ui.selectedYear;
  const month = ui.selectedMonth;

  const holidayMap = buildHolidayMap(year);
  const compSet = companyHolidaySet(year);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  daysContainer.innerHTML = "";

  for (let day = 1; day <= daysInMonth; day++) {
    const key = ymd(year, month, day);
    const rec = getDayRecord(year, key);
    const metrics = computeDayMetrics(year, key, holidayMap, compSet);

    const { datePart, holidayName } = formatDateLine(year, month, day, metrics.holidayName);

    const card = document.createElement("div");
    card.className = "day-card";
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

      const setInAuto = () => {
        if (metrics.isHolidayWork) {
          setDayRecord(year, key, { in: roundToMinuteHHMM() });
        } else {
          setDayRecord(year, key, { in: "09:30" });
        }
        renderAll();
      };

      const setOutAuto = () => {
        if (metrics.isHolidayWork) {
          setDayRecord(year, key, { out: roundToMinuteHHMM() });
        } else {
          setDayRecord(year, key, { out: "18:30" });
        }
        renderAll();
      };

      inBtn.addEventListener("click", setInAuto);
      outBtn.addEventListener("click", setOutAuto);

      inInput.addEventListener("change", () => {
        setDayRecord(year, key, { in: inInput.value || null });
        renderAll();
      });

      outInput.addEventListener("change", () => {
        setDayRecord(year, key, { out: outInput.value || null });
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

    const m = computeDayMetrics(year, key, holidayMap, compSet);

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

  sumWorkDays.textContent = `${workedDays}/${planned}`;
  sumTotalHours.textContent = totalHoursText;
  sumRegularHours.textContent = regularHoursText;
  sumOverHours.textContent = overtimeHoursText;

  sumRegularPay.textContent = `${Math.round(regularPaySum).toLocaleString(LOCALE)}円`;
  sumOverPay.textContent = `${Math.round(overtimePayExtraSum).toLocaleString(LOCALE)}円`;
  sumTotalPay.textContent = `${Math.round(totalPaySum).toLocaleString(LOCALE)}円`;
}

function renderAll() {
  // month tabs active update
  const tabs = monthTabsInner.querySelectorAll(".month-tab");
  tabs.forEach(btn => {
    const m = Number(btn.dataset.month);
    btn.classList.toggle("is-active", m === ui.selectedMonth);
  });

  computeMonthlySummary();
  renderDays();
}

/* ----------------------------
   設定
---------------------------- */
function openSettings() {
  yearInput.value = String(ui.selectedYear);
  hourlyWageInput.value = String(state.hourlyWage);

  const yd = ensureYearData(ui.selectedYear);
  companyHolidayList.innerHTML = "";
  for (const d of yd.companyHolidays) {
    companyHolidayList.appendChild(renderCompanyHolidayItem(ui.selectedYear, d));
  }
  settingsDialog.showModal();
}

function renderCompanyHolidayItem(year, dateKey) {
  const row = document.createElement("div");
  row.className = "company-holiday-item";

  const text = document.createElement("div");
  text.className = "company-holiday-text tabnums";
  text.textContent = dateKey;

  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete-btn";
  del.textContent = "削除";
  del.addEventListener("click", () => {
    const yd = ensureYearData(year);
    yd.companyHolidays = (yd.companyHolidays || []).filter(x => x !== dateKey);
    saveState();
    openSettings(); // 再描画
    renderAll();
  });

  row.appendChild(text);
  row.appendChild(del);
  return row;
}

settingsButton.addEventListener("click", openSettings);

addCompanyHoliday.addEventListener("click", () => {
  const v = companyHolidayDate.value;
  if (!v) return;

  const p = parseYmd(v);
  if (!p) return;
  if (p.y !== ui.selectedYear) {
    // 会社休日は単年管理のため、選択年と一致しない場合は追加しない
    window.alert("対象年と同じ年の日付を選択してください。");
    return;
  }

  const yd = ensureYearData(ui.selectedYear);
  const set = new Set(yd.companyHolidays || []);
  set.add(v);
  yd.companyHolidays = Array.from(set).sort();
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
  scrollSelectedTabToLeft();
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
    scrollSelectedTabToLeft();
    window.alert("復元しました。");
  } catch {
    window.alert("復元に失敗しました。");
  }
});

/* ----------------------------
   PWA: service worker
---------------------------- */
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
  ensureYearData(state.year);
  ui.selectedYear = state.year;
  applySummaryToneClasses();

  renderMonthTabs();
  scrollSelectedTabToLeft();
  renderAll();

  registerServiceWorker();
}

init();
