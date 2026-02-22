const YEAR = "2026";
const TERM_CODE = "1";
const STORAGE_KEY = `kaist_timetable_${YEAR}_${TERM_CODE}_selected`;
const LIST_LIMIT = 280;

const SLOT_MINUTES = 15;
const START_MINUTES = 8 * 60;
const END_MINUTES = 23 * 60;
const SLOT_COUNT = (END_MINUTES - START_MINUTES) / SLOT_MINUTES;

const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
const DAY_INDEX = Object.fromEntries(DAY_ORDER.map((day, idx) => [day, idx]));
const DAY_ALIASES = {
  Mon: "월",
  Tue: "화",
  Wed: "수",
  Thu: "목",
  Fri: "금",
  Sat: "토",
  Sun: "일",
  월: "월",
  화: "화",
  수: "수",
  목: "목",
  금: "금",
  토: "토",
  일: "일",
};

const PALETTE = [
  { bg: "rgba(64, 145, 108, 0.82)", border: "rgba(37, 89, 67, 0.88)" },
  { bg: "rgba(52, 104, 192, 0.82)", border: "rgba(34, 67, 123, 0.88)" },
  { bg: "rgba(208, 113, 54, 0.82)", border: "rgba(138, 75, 35, 0.88)" },
  { bg: "rgba(86, 124, 78, 0.82)", border: "rgba(57, 81, 52, 0.88)" },
  { bg: "rgba(0, 126, 167, 0.82)", border: "rgba(2, 77, 101, 0.88)" },
  { bg: "rgba(186, 104, 67, 0.82)", border: "rgba(118, 65, 42, 0.88)" },
  { bg: "rgba(41, 128, 185, 0.82)", border: "rgba(28, 84, 120, 0.88)" },
  { bg: "rgba(73, 131, 121, 0.82)", border: "rgba(46, 84, 77, 0.88)" },
];

const state = {
  sections: [],
  filteredSections: [],
  sectionById: new Map(),
  selectedIds: new Set(),
  conflictIds: new Set(),
  overlapOverlayEnabled: false,
};

const dom = {
  searchInput: document.querySelector("#searchInput"),
  overlapToggle: document.querySelector("#overlapToggle"),
  resetBtn: document.querySelector("#resetBtn"),
  summaryText: document.querySelector("#summaryText"),
  resultText: document.querySelector("#resultText"),
  conflictText: document.querySelector("#conflictText"),
  courseList: document.querySelector("#courseList"),
  selectedList: document.querySelector("#selectedList"),
  timetableGrid: document.querySelector("#timetableGrid"),
};

boot().catch((error) => {
  renderFatalError(error instanceof Error ? error.message : String(error));
});

async function boot() {
  bindEvents();
  const termRows = await loadTermRows();
  const sections = buildSections(termRows);

  state.sections = sections;
  state.filteredSections = sections;
  state.sectionById = new Map(sections.map((section) => [section.id, section]));

  restoreSelection();
  renderAll();
}

function bindEvents() {
  dom.searchInput.addEventListener("input", () => {
    applyFilter(dom.searchInput.value);
    renderCourseList();
    renderStatusText();
  });

  if (dom.overlapToggle) {
    dom.overlapToggle.checked = state.overlapOverlayEnabled;
    dom.overlapToggle.addEventListener("change", () => {
      state.overlapOverlayEnabled = dom.overlapToggle.checked;
      renderCourseList();
    });
  }

  dom.resetBtn.addEventListener("click", () => {
    state.selectedIds.clear();
    state.conflictIds.clear();
    persistSelection();
    renderSelectedArea();
    renderCourseList();
    renderStatusText();
  });

  dom.courseList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.id) {
      return;
    }

    const sectionId = target.dataset.id;
    if (!state.sectionById.has(sectionId)) {
      return;
    }

    state.selectedIds.add(sectionId);
    persistSelection();
    renderSelectedArea();
    renderCourseList();
    renderStatusText();
  });

  dom.selectedList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.id) {
      return;
    }

    state.selectedIds.delete(target.dataset.id);
    persistSelection();
    renderSelectedArea();
    renderCourseList();
    renderStatusText();
  });
}

async function loadTermRows() {
  const response = await fetch("courses.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`courses.json 로드 실패 (${response.status})`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error("courses.json 형식이 예상과 다릅니다.");
  }

  return rows.filter((row) =>
    String(row.syy) === YEAR &&
    String(row.smtDivCd) === TERM_CODE &&
    isUndergraduateRow(row),
  );
}

function buildSections(rows) {
  const sectionMap = new Map();

  for (const row of rows) {
    const subjtNo = normalizeSpace(row.subjtNo);
    const subjtNm = normalizeSpace(row.subjtNm);
    if (!subjtNo || !subjtNm) {
      continue;
    }

    const id = buildSectionId(row);
    if (sectionMap.has(id)) {
      continue;
    }

    sectionMap.set(id, {
      id,
      subjtNo,
      subjtNm,
      instructor: normalizeSpace(row.chrgInstrNmLisup) || "미정",
      dept: normalizeSpace(row.deprtNm) || "미분류",
      subjcDiv: normalizeSpace(row.subjcDivNm) || "구분 미정",
      credits: Number(row.cdt) || 0,
      lectureTime: normalizeLectureTime(row.lctreTm),
      classroom: normalizeSpace(row.lecrmNm) || "강의실 미정",
      delivery: normalizeSpace(row.tactUntctDivNm) || "수업형태 미정",
      capacity: toNullableNumber(row.atnlcPercpCnt),
      enrollment: toNonNegativeNumber(row.atnlcPcnt),
      sessions: parseLectureTimes(row.lctreTm),
    });
  }

  const sections = Array.from(sectionMap.values());
  for (const section of sections) {
    section.capacityDisplay = section.capacity === null ? "미정" : String(section.capacity);
    section.seatInfo = `정원 ${section.capacityDisplay} / 수강 ${section.enrollment}`;
    if (section.capacity !== null) {
      section.seatRemaining = section.capacity - section.enrollment;
      section.seatInfo += ` / 여석 ${section.seatRemaining}`;
    }

    section.searchFields = [
      section.subjtNo,
      section.subjtNm,
      section.instructor,
      section.dept,
      section.subjcDiv,
      section.lectureTime,
      section.classroom,
      section.delivery,
      section.seatInfo,
      String(section.enrollment),
      section.capacityDisplay,
    ]
      .map(normalizeForSearch)
      .filter(Boolean);
  }

  return sections.sort(compareSections);
}

function buildSectionId(row) {
  return [
    normalizeSpace(row.subjtNo),
    normalizeLectureTime(row.lctreTm),
    normalizeSpace(row.chrgInstrNmLisup),
  ].join("::");
}

function applyFilter(rawQuery) {
  const normalized = normalizeForSearch(rawQuery);
  if (!normalized) {
    state.filteredSections = state.sections;
    return;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  const scored = [];

  for (const section of state.sections) {
    const score = scoreSection(section, tokens);
    if (score > 0) {
      scored.push({ section, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || compareSections(a.section, b.section));
  state.filteredSections = scored.map((item) => item.section);
}

function restoreSelection() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return;
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return;
    }
    for (const id of parsed) {
      if (state.sectionById.has(id)) {
        state.selectedIds.add(id);
      }
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function persistSelection() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(state.selectedIds)));
}

function renderAll() {
  renderCourseList();
  renderSelectedArea();
  renderStatusText();
}

function renderStatusText() {
  const shown = Math.min(state.filteredSections.length, LIST_LIMIT);
  const limitSuffix = state.filteredSections.length > LIST_LIMIT ? ` (상위 ${shown}개 표시)` : "";

  dom.summaryText.textContent = `${YEAR}년 봄학기 학사과정 섹션 ${state.sections.length}개 로드됨`;
  dom.resultText.textContent = `검색 결과 ${state.filteredSections.length}개${limitSuffix} · 선택 ${state.selectedIds.size}개`;
}

function renderCourseList() {
  dom.courseList.innerHTML = "";

  if (state.filteredSections.length === 0) {
    dom.courseList.append(createEmpty("검색 결과가 없습니다."));
    return;
  }

  const fragment = document.createDocumentFragment();
  const visibleSections = state.filteredSections.slice(0, LIST_LIMIT);
  const selectedSessionIndex =
    state.overlapOverlayEnabled && state.selectedIds.size > 0 ? buildSelectedSessionIndex() : null;

  for (const section of visibleSections) {
    const li = document.createElement("li");
    li.className = "course-item";
    if (selectedSessionIndex && isSectionOverlappingSelected(section, selectedSessionIndex)) {
      li.classList.add("has-overlap-hint");
    }
    li.innerHTML = `
      <p class="course-title"><strong>${escapeHtml(section.subjtNo)}</strong> ${escapeHtml(section.subjtNm)}</p>
      <p class="course-meta">
        교수: ${escapeHtml(section.instructor)}<br>
        학과: ${escapeHtml(section.dept)} / 구분: ${escapeHtml(section.subjcDiv)}<br>
        학점: ${section.credits} / 수업형태: ${escapeHtml(section.delivery)}<br>
        정원/수강: ${escapeHtml(section.seatInfo)}<br>
        시간: ${escapeHtml(section.lectureTime)}<br>
        강의실: ${escapeHtml(section.classroom)}
      </p>
      <div class="course-actions"></div>
    `;

    const actionBox = li.querySelector(".course-actions");
    const button = document.createElement("button");
    button.className = "add-btn";
    button.type = "button";
    button.dataset.id = section.id;
    button.disabled = state.selectedIds.has(section.id);
    button.textContent = button.disabled ? "추가됨" : "추가";
    actionBox.append(button);

    fragment.append(li);
  }

  if (state.filteredSections.length > LIST_LIMIT) {
    const overflow = document.createElement("li");
    overflow.className = "empty";
    overflow.textContent = `검색 결과가 많아 상위 ${LIST_LIMIT}개만 표시합니다. 검색어를 더 구체화해 주세요.`;
    fragment.append(overflow);
  }

  dom.courseList.append(fragment);
}

function renderSelectedArea() {
  const selectedSections = Array.from(state.selectedIds)
    .map((id) => state.sectionById.get(id))
    .filter(Boolean)
    .sort((a, b) => a.subjtNo.localeCompare(b.subjtNo, "en", { numeric: true }));

  state.conflictIds = detectConflictIds(selectedSections);
  renderSelectedList(selectedSections);
  renderTimetable(selectedSections);
  renderConflictText();
}

function renderSelectedList(selectedSections) {
  dom.selectedList.innerHTML = "";

  if (selectedSections.length === 0) {
    dom.selectedList.append(createEmpty("선택한 과목이 없습니다."));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const section of selectedSections) {
    const li = document.createElement("li");
    li.className = "selected-item";
    if (state.conflictIds.has(section.id)) {
      li.classList.add("has-conflict");
    }

    li.innerHTML = `
      <p class="selected-title"><strong>${escapeHtml(section.subjtNo)}</strong> ${escapeHtml(section.subjtNm)}</p>
      <p class="selected-meta">
        ${escapeHtml(section.lectureTime)} · ${section.credits}학점<br>
        ${escapeHtml(section.instructor)} / ${escapeHtml(section.dept)}<br>
        ${escapeHtml(section.subjcDiv)} / ${escapeHtml(section.delivery)}<br>
        ${escapeHtml(section.seatInfo)}
      </p>
    `;

    const button = document.createElement("button");
    button.className = "remove-btn";
    button.type = "button";
    button.dataset.id = section.id;
    button.textContent = "제거";
    li.append(button);

    fragment.append(li);
  }

  dom.selectedList.append(fragment);
}

function renderConflictText() {
  if (state.conflictIds.size === 0) {
    dom.conflictText.textContent = "";
    return;
  }
  dom.conflictText.textContent = `시간 충돌: ${state.conflictIds.size}개 과목`;
}

function renderTimetable(selectedSections) {
  dom.timetableGrid.innerHTML = "";
  dom.timetableGrid.style.setProperty("--slot-count", String(SLOT_COUNT));

  const corner = document.createElement("div");
  corner.className = "grid-corner";
  corner.style.gridColumn = "1";
  corner.style.gridRow = "1";
  dom.timetableGrid.append(corner);

  for (let dayIdx = 0; dayIdx < DAY_ORDER.length; dayIdx += 1) {
    const header = document.createElement("div");
    header.className = "day-header";
    header.style.gridColumn = String(dayIdx + 2);
    header.style.gridRow = "1";
    header.textContent = DAY_ORDER[dayIdx];
    dom.timetableGrid.append(header);
  }

  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const minute = START_MINUTES + slot * SLOT_MINUTES;
    const label = document.createElement("div");
    const isMajor = minute % 60 === 0;
    label.className = isMajor ? "time-label" : "time-label minor";
    label.style.gridColumn = "1";
    label.style.gridRow = String(slot + 2);
    label.textContent = isMajor ? formatMinutes(minute) : "";
    dom.timetableGrid.append(label);

    for (let dayIdx = 0; dayIdx < DAY_ORDER.length; dayIdx += 1) {
      const cell = document.createElement("div");
      cell.className = "slot-cell";
      cell.style.gridColumn = String(dayIdx + 2);
      cell.style.gridRow = String(slot + 2);
      dom.timetableGrid.append(cell);
    }
  }

  for (const section of selectedSections) {
    const color = colorForSection(section.id);
    for (const session of section.sessions) {
      const dayIdx = DAY_INDEX[session.day];
      if (dayIdx === undefined) {
        continue;
      }

      const start = Math.max(session.start, START_MINUTES);
      const end = Math.min(session.end, END_MINUTES);
      if (end <= start) {
        continue;
      }

      const rowStart = 2 + Math.floor((start - START_MINUTES) / SLOT_MINUTES);
      const rowEnd = 2 + Math.ceil((end - START_MINUTES) / SLOT_MINUTES);

      const block = document.createElement("article");
      block.className = "class-block";
      if (state.conflictIds.has(section.id)) {
        block.classList.add("conflict");
      } else {
        block.style.backgroundColor = color.bg;
        block.style.borderColor = color.border;
      }
      block.style.gridColumn = String(dayIdx + 2);
      block.style.gridRow = `${rowStart} / ${Math.max(rowStart + 1, rowEnd)}`;
      block.title = `${section.subjtNo} ${section.subjtNm}\n${section.lectureTime}\n${section.instructor}\n${section.seatInfo}`;

      const span = rowEnd - rowStart;
      if (span <= 2) {
        block.innerHTML = `<strong>${escapeHtml(section.subjtNo)}</strong>`;
      } else {
        block.innerHTML = `
          <strong>${escapeHtml(section.subjtNo)}</strong>
          <span>${escapeHtml(section.subjtNm)}</span>
          <em>${formatMinutes(start)}-${formatMinutes(end)}</em>
        `;
      }

      dom.timetableGrid.append(block);
    }
  }
}

function detectConflictIds(selectedSections) {
  const conflicts = new Set();
  const sessionsByDay = new Map(DAY_ORDER.map((day) => [day, []]));

  for (const section of selectedSections) {
    for (const session of section.sessions) {
      if (!sessionsByDay.has(session.day)) {
        continue;
      }
      sessionsByDay.get(session.day).push({
        id: section.id,
        start: session.start,
        end: session.end,
      });
    }
  }

  for (const day of DAY_ORDER) {
    const sessions = sessionsByDay.get(day);
    sessions.sort((a, b) => a.start - b.start || a.end - b.end);

    for (let i = 0; i < sessions.length; i += 1) {
      for (let j = i + 1; j < sessions.length; j += 1) {
        if (sessions[j].start >= sessions[i].end) {
          break;
        }
        const overlapStart = Math.max(sessions[i].start, sessions[j].start);
        const overlapEnd = Math.min(sessions[i].end, sessions[j].end);
        if (overlapStart < overlapEnd) {
          conflicts.add(sessions[i].id);
          conflicts.add(sessions[j].id);
        }
      }
    }
  }

  return conflicts;
}

function buildSelectedSessionIndex() {
  const sessionsByDay = new Map(DAY_ORDER.map((day) => [day, []]));

  for (const sectionId of state.selectedIds) {
    const section = state.sectionById.get(sectionId);
    if (!section) {
      continue;
    }

    for (const session of section.sessions) {
      const daySessions = sessionsByDay.get(session.day);
      if (daySessions) {
        daySessions.push({ id: section.id, start: session.start, end: session.end });
      }
    }
  }

  for (const day of DAY_ORDER) {
    sessionsByDay.get(day).sort((a, b) => a.start - b.start || a.end - b.end);
  }

  return sessionsByDay;
}

function isSectionOverlappingSelected(section, selectedSessionIndex) {
  if (!selectedSessionIndex || !section.sessions || section.sessions.length === 0) {
    return false;
  }

  for (const session of section.sessions) {
    const daySessions = selectedSessionIndex.get(session.day);
    if (!daySessions || daySessions.length === 0) {
      continue;
    }

    for (const selected of daySessions) {
      if (selected.id === section.id) {
        continue;
      }
      if (selected.start >= session.end) {
        break;
      }
      if (sessionsOverlap(session, selected)) {
        return true;
      }
    }
  }

  return false;
}

function sessionsOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

function parseLectureTimes(raw) {
  if (!raw) {
    return [];
  }

  const sessions = [];
  const seen = new Set();
  const source = String(raw).replace(/\r/g, "\n");
  const pattern = /(Mon|Tue|Wed|Thu|Fri|Sat|Sun|월|화|수|목|금|토|일)\s*([0-2]\d:[0-5]\d)\s*~\s*([0-2]\d:[0-5]\d)/g;

  let match = pattern.exec(source);
  while (match) {
    const day = DAY_ALIASES[match[1]];
    const start = toMinutes(match[2]);
    const end = toMinutes(match[3]);

    if (day && Number.isFinite(start) && Number.isFinite(end) && end > start) {
      const key = `${day}-${start}-${end}`;
      if (!seen.has(key)) {
        sessions.push({ day, start, end });
        seen.add(key);
      }
    }

    match = pattern.exec(source);
  }

  sessions.sort((a, b) => DAY_INDEX[a.day] - DAY_INDEX[b.day] || a.start - b.start);
  return sessions;
}

function normalizeLectureTime(value) {
  const cleaned = normalizeSpace(value);
  return cleaned || "시간 미정";
}

function normalizeSpace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeForSearch(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareSections(a, b) {
  const codeDiff = a.subjtNo.localeCompare(b.subjtNo, "en", { numeric: true, sensitivity: "base" });
  if (codeDiff !== 0) {
    return codeDiff;
  }
  return a.subjtNm.localeCompare(b.subjtNm, "ko");
}

function scoreSection(section, tokens) {
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of section.searchFields) {
      const score = scoreTokenAgainstField(token, field);
      if (score > best) {
        best = score;
      }
      if (best >= 500) {
        break;
      }
    }
    if (best === 0) {
      return 0;
    }
    total += best;
  }
  return total;
}

function scoreTokenAgainstField(token, field) {
  if (!token || !field) {
    return 0;
  }

  const includeIdx = field.indexOf(token);
  if (includeIdx !== -1) {
    return 540 - Math.min(240, includeIdx * 4) - Math.min(140, Math.max(0, field.length - token.length));
  }

  if (token.length < 2) {
    return 0;
  }

  const gap = subsequenceGap(token, field);
  if (gap === -1) {
    return 0;
  }

  const score = 290 - Math.min(190, gap * 3) - Math.min(90, Math.max(0, field.length - token.length));
  return Math.max(0, score);
}

function subsequenceGap(token, field) {
  let tokenIdx = 0;
  let lastMatch = -1;
  let gapTotal = 0;

  for (let i = 0; i < field.length && tokenIdx < token.length; i += 1) {
    if (field[i] !== token[tokenIdx]) {
      continue;
    }
    if (lastMatch >= 0) {
      gapTotal += i - lastMatch - 1;
    }
    lastMatch = i;
    tokenIdx += 1;
  }

  return tokenIdx === token.length ? gapTotal : -1;
}

function isUndergraduateRow(row) {
  const code = String(row.subjtCrseDivCd ?? "").trim();
  const name = normalizeSpace(row.subjtCrseDivNm);
  return code === "0" || name === "학사과정";
}

function toMinutes(hhmm) {
  const [hh, mm] = hhmm.split(":").map(Number);
  return hh * 60 + mm;
}

function toNullableNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNonNegativeNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function formatMinutes(minutes) {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function colorForSection(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function createEmpty(text) {
  const li = document.createElement("li");
  li.className = "empty";
  li.textContent = text;
  return li;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderFatalError(message) {
  dom.summaryText.textContent = "시간표 플래너 로드 실패";
  dom.resultText.textContent = message;
  dom.courseList.innerHTML = "";
  dom.selectedList.innerHTML = "";
  dom.timetableGrid.innerHTML = "";
  dom.courseList.append(createEmpty("courses.json 파일을 로드할 수 없습니다. 정적 서버로 실행해 주세요."));
}
