/*
  ============================================================
  교사용 관리 기능
  ============================================================
  - 새 학급 코드 생성 또는 기존 학급 불러오기
  - 뉴스 제목, 댓글, 유튜브 ID 저장
  - 현재 단계 실시간 전송
  - 투표 시작/마감, 결과 공개/숨기기
  - 접속 학생 수와 단계별 응답자 수 표시
  - 투표 결과 그래프와 표 생성
  - 집계 결과 CSV 저장
  - 전체 투표와 성찰 결과 초기화
*/

import {
  db,
  ref,
  set,
  update,
  get,
  remove,
  onValue,
  serverTimestamp
} from "./firebase-config.js";

/* ------------------------------------------------------------
   단계 정보
   ------------------------------------------------------------ */

const TOTAL_STEPS = 14;

const STEP_INFO = {
  1: { title: "학생 입장 대기", description: "학생들이 학급 코드와 별명을 입력해 참여합니다." },
  2: { title: "뉴스 제목 공개", description: "학생 화면에는 뉴스 제목만 표시됩니다." },
  3: { title: "1차 투표", description: "제목만 본 상태에서 첫 판단을 투표합니다." },
  4: { title: "1차 투표 후 대기", description: "다음 자료를 보기 전 잠시 기다립니다." },
  5: { title: "첫 번째 댓글 공개", description: "첫 번째 댓글 묶음을 학생 화면에 보여줍니다." },
  6: { title: "2차 투표", description: "댓글을 읽은 뒤 판단을 다시 투표합니다." },
  7: { title: "2차 투표 후 대기", description: "두 번째 댓글 공개 전 대기합니다." },
  8: { title: "두 번째 댓글 공개", description: "두 번째 댓글 묶음을 학생 화면에 보여줍니다." },
  9: { title: "3차 투표", description: "두 번째 댓글을 읽은 뒤 다시 판단을 투표합니다." },
  10: { title: "실시간 의견 나눔", description: "3차 투표를 마감한 뒤 학생 채팅을 열어 생각과 이유를 나눕니다." },
  11: { title: "1·2·3차 결과 비교", description: "세 차례 투표를 그룹 막대그래프로 비교합니다." },
  12: { title: "뉴스 영상 시청", description: "유튜브 뉴스 영상을 학생 화면에 보여줍니다." },
  13: { title: "최종 투표", description: "뉴스 전체를 본 뒤 최종 판단을 투표합니다." },
  14: { title: "성찰 활동", description: "학생들이 판단 변화 과정을 돌아봅니다." }
};

const VOTE_STEP_KEY = {
  3: "vote1",
  6: "vote2",
  9: "vote3",
  13: "final"
};

const VOTE_LABELS = {
  vote1: ["학생", "학부모", "교사", "기타"],
  vote2: ["학생", "학부모", "교사", "기타"],
  vote3: ["학생", "학부모", "교사", "기타"],
  final: [
    "학생이 가장 문제다",
    "학부모가 가장 문제다",
    "교사가 가장 문제다",
    "여러 주체에게 책임이 있다",
    "주어진 정보만으로 판단하기 어렵다"
  ]
};

/* ------------------------------------------------------------
   화면 요소
   ------------------------------------------------------------ */

const classCodeInput = document.getElementById("classCodeInput");
const createClassButton = document.getElementById("createClassButton");
const loadClassButton = document.getElementById("loadClassButton");
const classConnectionStatus = document.getElementById("classConnectionStatus");

const newsTitleInput = document.getElementById("newsTitleInput");
const studentCommentInputs = [
  ...document.querySelectorAll(".student-comment-input")
];
const parentCommentInputs = [
  ...document.querySelectorAll(".parent-comment-input")
];
const youtubeIdInput = document.getElementById("youtubeIdInput");
const commentOrderSelect = document.getElementById("commentOrderSelect");
const saveSettingsButton = document.getElementById("saveSettingsButton");

const activeClassCode = document.getElementById("activeClassCode");
const connectedCount = document.getElementById("connectedCount");
const currentStepSummary = document.getElementById("currentStepSummary");
const voteStatusSummary = document.getElementById("voteStatusSummary");
const currentStepTitle = document.getElementById("currentStepTitle");
const currentStepBadge = document.getElementById("currentStepBadge");
const teacherProgressBar = document.getElementById("teacherProgressBar");
const stepDescription = document.getElementById("stepDescription");

const previousStepButton = document.getElementById("previousStepButton");
const nextStepButton = document.getElementById("nextStepButton");
const openVoteButton = document.getElementById("openVoteButton");
const closeVoteButton = document.getElementById("closeVoteButton");
const showResultsButton = document.getElementById("showResultsButton");
const hideResultsButton = document.getElementById("hideResultsButton");
const openChatButton = document.getElementById("openChatButton");
const closeChatButton = document.getElementById("closeChatButton");
const clearChatButton = document.getElementById("clearChatButton");
const chatMessageCount = document.getElementById("chatMessageCount");
const refreshResultsButton = document.getElementById("refreshResultsButton");

const vote1Count = document.getElementById("vote1Count");
const vote2Count = document.getElementById("vote2Count");
const vote3Count = document.getElementById("vote3Count");
const finalVoteCount = document.getElementById("finalVoteCount");
const reflectionCount = document.getElementById("reflectionCount");

const resultTable = document.getElementById("resultTable");
const downloadCsvButton = document.getElementById("downloadCsvButton");
const printReportButton = document.getElementById("printReportButton");
const resetVotesButton = document.getElementById("resetVotesButton");
const studentList = document.getElementById("studentList");
const keywordSummary = document.getElementById("keywordSummary");
const wordCloud = document.getElementById("wordCloud");
const analysisMessageCount = document.getElementById("analysisMessageCount");
const teacherToast = document.getElementById("teacherToast");

let currentClassCode = localStorage.getItem("teacherClassCode") || "";
let currentClassData = null;
let classListenerStop = null;
let teacherChart = null;
let toastTimer = null;

/* ------------------------------------------------------------
   유틸리티
   ------------------------------------------------------------ */

function normalizeClassCode(value) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function generateClassCode(length = 6) {
  /*
    헷갈리기 쉬운 0, O, 1, I는 제외합니다.
  */
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < length; i += 1) {
    code += characters[Math.floor(Math.random() * characters.length)];
  }

  return code;
}

function showToast(message) {
  teacherToast.textContent = message;
  teacherToast.classList.remove("hidden");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    teacherToast.classList.add("hidden");
  }, 2800);
}

function setConnectionStatus(message, connected = false) {
  classConnectionStatus.textContent = message;
  classConnectionStatus.classList.toggle("connected-status", connected);
  classConnectionStatus.classList.toggle("muted-status", !connected);
}

function isVoteStep(step) {
  return Boolean(VOTE_STEP_KEY[step]);
}

function objectSize(value) {
  return value ? Object.keys(value).length : 0;
}

function countByChoice(voteObject, labels) {
  const result = Object.fromEntries(labels.map((label) => [label, 0]));

  Object.values(voteObject || {}).forEach((vote) => {
    if (vote?.choice in result) {
      result[vote.choice] += 1;
    }
  });

  return result;
}

/* ------------------------------------------------------------
   학급 생성과 불러오기
   ------------------------------------------------------------ */

async function createNewClass() {
  createClassButton.disabled = true;
  createClassButton.textContent = "생성 중...";

  try {
    let code = "";
    let exists = true;

    /*
      매우 드물게 코드가 겹칠 수 있으므로 존재하지 않는 코드를 찾을 때까지 반복합니다.
    */
    while (exists) {
      code = generateClassCode();
      const snapshot = await get(ref(db, `classes/${code}/settings`));
      exists = snapshot.exists();
    }

    const defaultData = {
      settings: {
        currentStep: 1,
        voteOpen: false,
        resultsVisible: false,
        chatOpen: false,
        newsTitle: "",
        studentComments: ["", "", "", ""],
        parentComments: ["", "", "", ""],
        youtubeId: "",
        commentOrder: "studentFirst",
        resolvedCommentOrder: "studentFirst",
        createdAt: serverTimestamp()
      }
    };

    await set(ref(db, `classes/${code}`), defaultData);

    currentClassCode = code;
    localStorage.setItem("teacherClassCode", code);
    classCodeInput.value = code;

    subscribeToClass();
    showToast(`새 학급 ${code}가 생성되었습니다.`);
  } catch (error) {
    console.error(error);
    showToast("학급 생성에 실패했습니다. Firebase 설정을 확인하세요.");
  } finally {
    createClassButton.disabled = false;
    createClassButton.textContent = "새 학급 코드 생성";
  }
}

async function loadExistingClass() {
  const code = normalizeClassCode(classCodeInput.value);

  if (code.length !== 6) {
    showToast("학급 코드는 영문과 숫자 6자리로 입력하세요.");
    return;
  }

  try {
    const snapshot = await get(ref(db, `classes/${code}/settings`));

    if (!snapshot.exists()) {
      showToast("해당 학급 코드를 찾을 수 없습니다.");
      return;
    }

    currentClassCode = code;
    localStorage.setItem("teacherClassCode", code);
    subscribeToClass();
    showToast(`학급 ${code}를 불러왔습니다.`);
  } catch (error) {
    console.error(error);
    showToast("학급을 불러오지 못했습니다.");
  }
}

/* Firebase의 학급 전체 데이터를 실시간으로 구독합니다. */
function subscribeToClass() {
  if (!currentClassCode) return;

  if (typeof classListenerStop === "function") {
    classListenerStop();
  }

  setConnectionStatus(`${currentClassCode} 학급에 연결 중입니다.`);

  classListenerStop = onValue(
    ref(db, `classes/${currentClassCode}`),
    (snapshot) => {
      if (!snapshot.exists()) {
        setConnectionStatus("학급 데이터가 존재하지 않습니다.");
        return;
      }

      currentClassData = snapshot.val();
      classCodeInput.value = currentClassCode;
      setConnectionStatus(`${currentClassCode} 학급에 연결되었습니다.`, true);
      renderTeacherDashboard();
    },
    (error) => {
      console.error(error);
      setConnectionStatus("실시간 연결에 실패했습니다.");
    }
  );
}

/* ------------------------------------------------------------
   설정 저장
   ------------------------------------------------------------ */

async function saveSettings() {
  if (!currentClassCode) {
    showToast("먼저 학급을 생성하거나 불러오세요.");
    return;
  }

  const studentComments = studentCommentInputs.map((input) =>
    input.value.trim()
  );
  const parentComments = parentCommentInputs.map((input) =>
    input.value.trim()
  );

  const selectedOrder = commentOrderSelect.value;
  const resolvedOrder =
    selectedOrder === "random"
      ? (Math.random() < 0.5 ? "studentFirst" : "parentFirst")
      : selectedOrder;

  const settingsUpdate = {
    newsTitle: newsTitleInput.value.trim(),
    studentComments,
    parentComments,
    youtubeId: youtubeIdInput.value.trim(),
    commentOrder: selectedOrder,
    resolvedCommentOrder: resolvedOrder
  };

  saveSettingsButton.disabled = true;
  saveSettingsButton.textContent = "저장 중...";

  try {
    await update(
      ref(db, `classes/${currentClassCode}/settings`),
      settingsUpdate
    );

    showToast("수업 자료를 저장했습니다.");
  } catch (error) {
    console.error(error);
    showToast("수업 자료 저장에 실패했습니다.");
  } finally {
    saveSettingsButton.disabled = false;
    saveSettingsButton.textContent = "수업 자료 저장";
  }
}

/* 저장된 설정을 입력 칸에 채웁니다. */
function fillSettingsForm(settings) {
  /*
    사용자가 입력 중인 글이 실시간 갱신 때문에 사라지지 않도록
    현재 입력 요소가 포커스 상태일 때는 값을 덮어쓰지 않습니다.
  */
  if (document.activeElement !== newsTitleInput) {
    newsTitleInput.value = settings.newsTitle || "";
  }

  const studentComments = Array.isArray(settings.studentComments)
    ? settings.studentComments
    : Object.values(settings.studentComments || {});

  const parentComments = Array.isArray(settings.parentComments)
    ? settings.parentComments
    : Object.values(settings.parentComments || {});

  studentCommentInputs.forEach((input, index) => {
    if (document.activeElement !== input) {
      input.value = studentComments[index] || "";
    }
  });

  parentCommentInputs.forEach((input, index) => {
    if (document.activeElement !== input) {
      input.value = parentComments[index] || "";
    }
  });

  if (document.activeElement !== youtubeIdInput) {
    youtubeIdInput.value = settings.youtubeId || "";
  }

  commentOrderSelect.value = settings.commentOrder || "studentFirst";
}

/* ------------------------------------------------------------
   단계 제어
   ------------------------------------------------------------ */

async function changeStep(direction) {
  if (!currentClassCode || !currentClassData) return;

  const currentStep = Number(currentClassData.settings?.currentStep) || 1;
  const nextStep = Math.min(
    Math.max(currentStep + direction, 1),
    TOTAL_STEPS
  );

  if (nextStep === currentStep) return;

  try {
    await update(ref(db, `classes/${currentClassCode}/settings`), {
      currentStep: nextStep,
      voteOpen: false,
      chatOpen: false,
      resultsVisible:
        nextStep === 10
          ? currentClassData.settings?.resultsVisible === true
          : false
    });

    showToast(`${nextStep}단계로 이동했습니다.`);
  } catch (error) {
    console.error(error);
    showToast("단계를 변경하지 못했습니다.");
  }
}

async function setVoteOpen(isOpen) {
  if (!currentClassCode || !currentClassData) return;

  const step = Number(currentClassData.settings?.currentStep) || 1;

  if (!isVoteStep(step)) {
    showToast("현재 단계는 투표 단계가 아닙니다.");
    return;
  }

  try {
    await update(ref(db, `classes/${currentClassCode}/settings`), {
      voteOpen: isOpen
    });

    showToast(isOpen ? "투표를 시작했습니다." : "투표를 마감했습니다.");
  } catch (error) {
    console.error(error);
    showToast("투표 상태를 변경하지 못했습니다.");
  }
}

async function setResultsVisible(visible) {
  if (!currentClassCode) return;

  try {
    await update(ref(db, `classes/${currentClassCode}/settings`), {
      resultsVisible: visible
    });

    showToast(visible ? "학생에게 결과를 공개했습니다." : "결과를 숨겼습니다.");
  } catch (error) {
    console.error(error);
    showToast("결과 공개 상태를 변경하지 못했습니다.");
  }
}

/* ------------------------------------------------------------
   대시보드 렌더링
   ------------------------------------------------------------ */

function renderTeacherDashboard() {
  const settings = currentClassData?.settings || {};
  const step = Number(settings.currentStep) || 1;
  const stepInfo = STEP_INFO[step];

  activeClassCode.textContent = currentClassCode;
  connectedCount.textContent = objectSize(currentClassData?.presence);
  currentStepSummary.textContent = `${step}단계`;
  voteStatusSummary.textContent = isVoteStep(step)
    ? settings.voteOpen
      ? "진행 중"
      : "마감/대기"
    : "투표 아님";

  currentStepTitle.textContent = stepInfo.title;
  currentStepBadge.textContent = `${step} / ${TOTAL_STEPS}`;
  teacherProgressBar.style.width = `${(step / TOTAL_STEPS) * 100}%`;
  stepDescription.textContent = stepInfo.description;

  previousStepButton.disabled = step <= 1;
  nextStepButton.disabled = step >= TOTAL_STEPS;

  openVoteButton.disabled = !isVoteStep(step) || settings.voteOpen === true;
  closeVoteButton.disabled = !isVoteStep(step) || settings.voteOpen !== true;

  showResultsButton.disabled =
    step !== 11 || settings.resultsVisible === true;
  hideResultsButton.disabled =
    step !== 11 || settings.resultsVisible !== true;
  openChatButton.disabled = step !== 10 || settings.chatOpen === true;
  closeChatButton.disabled = step !== 10 || settings.chatOpen !== true;
  clearChatButton.disabled = step !== 10;
  chatMessageCount.textContent = `${objectSize(currentClassData?.chat)}개`;

  downloadCsvButton.disabled = false;
  printReportButton.disabled = false;
  resetVotesButton.disabled = false;

  fillSettingsForm(settings);
  renderStudentList();
  renderResponseCounts();
  renderResults();
  renderChatAnalysis();
}


function escapeAdminHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderStudentList() {
  const students = Object.values(currentClassData?.presence || {})
    .map((item) => item?.nickname)
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b), "ko"));

  if (!students.length) {
    studentList.innerHTML =
      '<p class="empty-admin-state">접속한 학생이 없습니다.</p>';
    return;
  }

  studentList.innerHTML = students
    .map((name) => `<span class="student-chip">${escapeAdminHtml(name)}</span>`)
    .join("");
}

function analyzeChatKeywords() {
  const stopwords = new Set([
    "그리고", "그러나", "그래서", "하지만", "때문", "생각", "같다", "같아요",
    "있다", "없다", "한다", "합니다", "했다", "학생", "학부모", "교사",
    "문제", "가장", "정말", "조금", "너무", "그냥", "저는", "나는", "우리",
    "뉴스", "댓글", "이유", "것", "수", "더", "잘", "좀", "도", "은", "는",
    "이", "가", "을", "를", "에", "의", "와", "과", "로", "으로"
  ]);

  const messages = Object.values(currentClassData?.chat || {});
  const counts = {};

  messages.forEach((message) => {
    const words = String(message?.text || "")
      .replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, " ")
      .split(/\s+/)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length >= 2 && !stopwords.has(word));

    words.forEach((word) => {
      counts[word] = (counts[word] || 0) + 1;
    });
  });

  return {
    messageCount: messages.length,
    keywords: Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
      .slice(0, 20)
  };
}

function renderChatAnalysis() {
  const analysis = analyzeChatKeywords();
  analysisMessageCount.textContent = `${analysis.messageCount}개 분석`;

  if (!analysis.keywords.length) {
    keywordSummary.innerHTML = "";
    wordCloud.innerHTML =
      '<p class="empty-admin-state">채팅이 시작되면 주요어가 표시됩니다.</p>';
    return;
  }

  keywordSummary.innerHTML = analysis.keywords.slice(0, 5)
    .map(([word, count]) => `
      <div class="keyword-card">
        <strong>${escapeAdminHtml(word)}</strong>
        <span>${count}회</span>
      </div>`)
    .join("");

  const maxCount = analysis.keywords[0][1];
  wordCloud.innerHTML = analysis.keywords
    .map(([word, count]) => {
      const size = 15 + Math.round((count / maxCount) * 23);
      const opacity = 0.58 + (count / maxCount) * 0.42;
      return `<span class="word-cloud-item"
        style="font-size:${size}px;opacity:${opacity}">
        ${escapeAdminHtml(word)}
      </span>`;
    })
    .join("");
}

function renderResponseCounts() {
  const votes = currentClassData?.votes || {};

  vote1Count.textContent = `${objectSize(votes.vote1)}명`;
  vote2Count.textContent = `${objectSize(votes.vote2)}명`;
  vote3Count.textContent = `${objectSize(votes.vote3)}명`;
  finalVoteCount.textContent = `${objectSize(votes.final)}명`;
  reflectionCount.textContent = `${objectSize(
    currentClassData?.reflections
  )}명`;
}

/* 현재 단계에 가장 알맞은 그래프를 표시합니다. */
function renderResults() {
  const step = Number(currentClassData?.settings?.currentStep) || 1;
  const votes = currentClassData?.votes || {};

  let labels = [];
  let datasets = [];
  let tableHtml = "";

  if (step === 11) {
    labels = VOTE_LABELS.vote1;

    const stageKeys = ["vote1", "vote2", "vote3"];
    const stageNames = ["1차 투표", "2차 투표", "3차 투표"];

    datasets = stageKeys.map((key, index) => {
      const counts = countByChoice(votes[key], labels);

      return {
        label: stageNames[index],
        data: labels.map((label) => counts[label]),
        backgroundColor: [
          "rgba(109, 63, 192, 0.76)",
          "rgba(40, 145, 120, 0.76)",
          "rgba(222, 132, 54, 0.76)"
        ][index]
      };
    });

    tableHtml = buildComparisonTable(labels, datasets);
  } else {
    const voteKey = VOTE_STEP_KEY[step] || "vote1";
    labels = VOTE_LABELS[voteKey];

    const counts = countByChoice(votes[voteKey], labels);

    datasets = [
      {
        label: getVoteDisplayName(voteKey),
        data: labels.map((label) => counts[label]),
        backgroundColor: "rgba(109, 63, 192, 0.78)"
      }
    ];

    tableHtml = buildSingleVoteTable(labels, counts);
  }

  const canvas = document.getElementById("teacherResultChart");

  if (teacherChart) {
    teacherChart.destroy();
  }

  teacherChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0
          },
          title: {
            display: true,
            text: "응답자 수"
          }
        }
      },
      plugins: {
        legend: {
          display: datasets.length > 1,
          position: "bottom"
        }
      }
    }
  });

  resultTable.innerHTML = tableHtml;
}

function getVoteDisplayName(voteKey) {
  const names = {
    vote1: "1차 투표",
    vote2: "2차 투표",
    vote3: "3차 투표",
    final: "최종 투표"
  };

  return names[voteKey];
}

function buildSingleVoteTable(labels, counts) {
  return `
    <table>
      <thead>
        <tr>
          <th>선택지</th>
          <th>응답자 수</th>
        </tr>
      </thead>
      <tbody>
        ${labels
          .map(
            (label) => `
              <tr>
                <td>${label}</td>
                <td>${counts[label]}명</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function buildComparisonTable(labels, datasets) {
  return `
    <table>
      <thead>
        <tr>
          <th>선택지</th>
          ${datasets.map((dataset) => `<th>${dataset.label}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${labels
          .map(
            (label, labelIndex) => `
              <tr>
                <td>${label}</td>
                ${datasets
                  .map(
                    (dataset) => `<td>${dataset.data[labelIndex]}명</td>`
                  )
                  .join("")}
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

/* 3차 투표 후 실시간 채팅 관리 */
async function setChatOpen(isOpen) {
  if (!currentClassCode || !currentClassData) return;
  const step = Number(currentClassData.settings?.currentStep) || 1;

  if (step !== 10) {
    showToast("채팅은 의견 나눔 단계에서만 열 수 있습니다.");
    return;
  }

  await update(ref(db, `classes/${currentClassCode}/settings`), {
    chatOpen: isOpen
  });
  showToast(isOpen ? "학생 채팅을 열었습니다." : "학생 채팅을 닫았습니다.");
}

async function clearChat() {
  if (!currentClassCode) return;
  if (!confirm("현재 학급의 채팅 내용을 모두 삭제하시겠습니까?")) return;
  await remove(ref(db, `classes/${currentClassCode}/chat`));
  showToast("채팅 내용을 모두 삭제했습니다.");
}

/* ------------------------------------------------------------
   CSV 저장
   ------------------------------------------------------------ */

function downloadCsv() {
  if (!currentClassCode || !currentClassData) return;

  const votes = currentClassData.votes || {};
  const rows = [
    ["학급 코드", currentClassCode],
    ["저장 시각", new Date().toLocaleString("ko-KR")],
    [],
    ["단계", "선택지", "응답자 수"]
  ];

  ["vote1", "vote2", "vote3", "final"].forEach((voteKey) => {
    const labels = VOTE_LABELS[voteKey];
    const counts = countByChoice(votes[voteKey], labels);

    labels.forEach((label) => {
      rows.push([getVoteDisplayName(voteKey), label, counts[label]]);
    });
  });

  rows.push([]);
  rows.push([
    "성찰 활동 제출자 수",
    objectSize(currentClassData.reflections)
  ]);

  /*
    한글이 엑셀에서 깨지지 않도록 UTF-8 BOM(\uFEFF)을 앞에 붙입니다.
  */
  const csvText =
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
          .join(",")
      )
      .join("\n");

  const blob = new Blob([csvText], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `뉴스리터러시_투표결과_${currentClassCode}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
  showToast("집계 결과 CSV를 저장했습니다.");
}

/* ------------------------------------------------------------
   결과 초기화
   ------------------------------------------------------------ */


function printClassReport() {
  if (!currentClassCode || !currentClassData) return;

  const votes = currentClassData.votes || {};
  const analysis = analyzeChatKeywords();
  const settings = currentClassData.settings || {};

  const voteSections = ["vote1", "vote2", "vote3", "final"].map((voteKey) => {
    const labels = VOTE_LABELS[voteKey];
    const counts = countByChoice(votes[voteKey], labels);
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);

    const rows = labels.map((label) => {
      const count = counts[label];
      const percent = total ? Math.round((count / total) * 100) : 0;
      return `<tr><td>${escapeAdminHtml(label)}</td><td>${count}명</td><td>${percent}%</td></tr>`;
    }).join("");

    return `
      <section>
        <h2>${getVoteDisplayName(voteKey)}</h2>
        <table><thead><tr><th>선택지</th><th>응답</th><th>비율</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </section>`;
  }).join("");

  const keywordText = analysis.keywords.slice(0, 10)
    .map(([word, count]) => `${escapeAdminHtml(word)}(${count})`)
    .join(", ") || "채팅 주요어 없음";

  const popup = window.open("", "_blank", "width=900,height=900");
  if (!popup) {
    showToast("팝업 차단을 해제한 뒤 다시 시도하세요.");
    return;
  }

  popup.document.write(`<!DOCTYPE html>
  <html lang="ko"><head><meta charset="UTF-8">
  <title>미톡 라이브 수업 리포트</title>
  <style>
    body{font-family:Arial,'Noto Sans KR',sans-serif;color:#241b2f;margin:36px;line-height:1.6}
    h1{color:#3c1b6e;margin-bottom:4px} h2{margin-top:30px;color:#6d3fc0}
    .meta{padding:16px;background:#f4effb;border-radius:12px}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    th,td{border:1px solid #ddd;padding:9px;text-align:left} th{background:#f4effb}
    .guide{margin-top:30px;padding:18px;border:2px solid #ded0f8;border-radius:12px}
    @media print{button{display:none} body{margin:15mm}}
  </style></head><body>
  <h1>미톡 라이브 수업 결과</h1>
  <p>${new Date().toLocaleString("ko-KR")}</p>
  <div class="meta">
    <strong>학급 코드:</strong> ${escapeAdminHtml(currentClassCode)}<br>
    <strong>뉴스 제목:</strong> ${escapeAdminHtml(settings.newsTitle || "-")}<br>
    <strong>현재 접속:</strong> ${objectSize(currentClassData.presence)}명<br>
    <strong>채팅 의견:</strong> ${analysis.messageCount}개<br>
    <strong>성찰 제출:</strong> ${objectSize(currentClassData.reflections)}명
  </div>
  ${voteSections}
  <section><h2>채팅 주요어</h2><p>${keywordText}</p></section>
  <div class="guide">
    <strong>교육적 안내</strong>
    <p>이번 활동에서는 댓글이 판단에 미치는 영향을 알아보기 위해 특정 대상을 비판하는 댓글만 의도적으로 골라 보여주었습니다.</p>
    <p>댓글은 다른 사람의 의견입니다. 뉴스의 전체 내용을 확인한 뒤 자신의 판단을 만들어야 합니다.</p>
  </div>
  <p><button onclick="window.print()">인쇄 또는 PDF로 저장</button></p>
  </body></html>`);
  popup.document.close();
  popup.focus();
}

async function resetVotes() {
  if (!currentClassCode) return;

  const confirmed = confirm(
    "1·2·3차 및 최종 투표와 성찰 응답을 모두 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다."
  );

  if (!confirmed) return;

  try {
    await Promise.all([
      remove(ref(db, `classes/${currentClassCode}/votes`)),
      remove(ref(db, `classes/${currentClassCode}/reflections`)),
      remove(ref(db, `classes/${currentClassCode}/chat`)),
      update(ref(db, `classes/${currentClassCode}/settings`), {
        currentStep: 1,
        voteOpen: false,
        resultsVisible: false
      })
    ]);

    showToast("투표와 성찰 결과를 초기화했습니다.");
  } catch (error) {
    console.error(error);
    showToast("결과 초기화에 실패했습니다.");
  }
}

/* ------------------------------------------------------------
   이벤트 연결
   ------------------------------------------------------------ */

createClassButton.addEventListener("click", createNewClass);
loadClassButton.addEventListener("click", loadExistingClass);
saveSettingsButton.addEventListener("click", saveSettings);

previousStepButton.addEventListener("click", () => changeStep(-1));
nextStepButton.addEventListener("click", () => changeStep(1));
openVoteButton.addEventListener("click", () => setVoteOpen(true));
closeVoteButton.addEventListener("click", () => setVoteOpen(false));
showResultsButton.addEventListener("click", () => setResultsVisible(true));
hideResultsButton.addEventListener("click", () => setResultsVisible(false));
openChatButton.addEventListener("click", () => setChatOpen(true));
closeChatButton.addEventListener("click", () => setChatOpen(false));
clearChatButton.addEventListener("click", clearChat);
refreshResultsButton.addEventListener("click", renderResults);
downloadCsvButton.addEventListener("click", downloadCsv);
printReportButton.addEventListener("click", printClassReport);
resetVotesButton.addEventListener("click", resetVotes);

classCodeInput.addEventListener("input", () => {
  classCodeInput.value = normalizeClassCode(classCodeInput.value);
});

/* ------------------------------------------------------------
   앱 시작
   ------------------------------------------------------------ */

async function startTeacherApp() {
  if (!currentClassCode) {
    setConnectionStatus("학급 코드를 생성하거나 기존 코드를 불러오세요.");
    return;
  }

  classCodeInput.value = currentClassCode;

  try {
    const snapshot = await get(
      ref(db, `classes/${currentClassCode}/settings`)
    );

    if (!snapshot.exists()) {
      localStorage.removeItem("teacherClassCode");
      currentClassCode = "";
      setConnectionStatus(
        "이전에 사용한 학급을 찾을 수 없습니다. 새 학급을 생성하세요."
      );
      return;
    }

    subscribeToClass();
  } catch (error) {
    console.error(error);
    setConnectionStatus("자동 연결에 실패했습니다.");
  }
}

startTeacherApp();
