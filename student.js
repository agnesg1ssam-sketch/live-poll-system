/*
  ============================================================
  학생용 기능
  ============================================================
  - 학급 코드와 별명으로 참여
  - 교사가 변경한 현재 단계를 실시간으로 수신
  - 같은 기기에서 같은 투표 단계에 중복 투표 방지
  - 교사가 결과를 공개하기 전에는 결과를 표시하지 않음
  - 개별 학생의 투표 내용은 화면에 공개하지 않음
*/

import {
  db,
  ref,
  set,
  get,
  onValue,
  onDisconnect,
  serverTimestamp
} from "./firebase-config.js";

/* ------------------------------------------------------------
   기본 상수와 화면 요소
   ------------------------------------------------------------ */

const TOTAL_STEPS = 13;

const STEP_TITLES = {
  1: "학급 참여",
  2: "뉴스 확인",
  3: "생각 선택하기",
  4: "잠시 기다리기",
  5: "댓글 읽기",
  6: "생각 다시 선택하기",
  7: "잠시 기다리기",
  8: "댓글 더 읽기",
  9: "생각 다시 선택하기",
  10: "결과 비교하기",
  11: "뉴스 전체 보기",
  12: "최종 생각 선택하기",
  13: "활동 돌아보기"
};

const VOTE_OPTIONS = {
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

const studentApp = document.getElementById("studentApp");
const progressArea = document.getElementById("progressArea");
const progressBar = document.getElementById("progressBar");
const stepLabel = document.getElementById("stepLabel");
const progressText = document.getElementById("progressText");
const studentIdentity = document.getElementById("studentIdentity");
const studentClassCode = document.getElementById("studentClassCode");
const studentNickname = document.getElementById("studentNickname");

/* ------------------------------------------------------------
   기기 식별값
   ------------------------------------------------------------
   로그인 없이도 같은 기기에서 중복 투표를 막기 위해 브라우저의
   localStorage에 임의의 기기 ID를 한 번 저장합니다.
   이 값은 이름이나 전화번호 같은 개인정보가 아닙니다.
*/
function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem("newsVoteDeviceId");

  if (!deviceId) {
    deviceId =
      "device_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 10);

    localStorage.setItem("newsVoteDeviceId", deviceId);
  }

  return deviceId;
}

const deviceId = getOrCreateDeviceId();

/* 현재 참여 정보 */
let classCode = localStorage.getItem("newsVoteClassCode") || "";
let nickname = localStorage.getItem("newsVoteNickname") || "";
let classListenerStop = null;
let currentClassData = null;
let studentChart = null;

/* ------------------------------------------------------------
   공통 유틸리티
   ------------------------------------------------------------ */

/* 사용자가 입력한 문자열을 HTML에 안전하게 표시합니다. */
function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* 학급 코드는 공백을 제거하고 영문 대문자로 통일합니다. */
function normalizeClassCode(value) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* 현재 단계에 맞게 상단 진행률을 갱신합니다. */
function updateProgress(step) {
  const safeStep = Math.min(Math.max(Number(step) || 1, 1), TOTAL_STEPS);
  const percentage = (safeStep / TOTAL_STEPS) * 100;

  progressArea.classList.remove("hidden");
  stepLabel.textContent = `${safeStep}단계 · ${STEP_TITLES[safeStep]}`;
  progressText.textContent = `${safeStep} / ${TOTAL_STEPS}`;
  progressBar.style.width = `${percentage}%`;
}

/* 화면 상단에 학급 코드와 별명을 표시합니다. */
function updateIdentity() {
  if (!classCode || !nickname) {
    studentIdentity.classList.add("hidden");
    return;
  }

  studentClassCode.textContent = `학급 ${classCode}`;
  studentNickname.textContent = nickname;
  studentIdentity.classList.remove("hidden");
}

/* 같은 단계 투표 완료 여부를 localStorage에서 확인합니다. */
function localVoteKey(voteKey) {
  return `newsVoteSubmitted_${classCode}_${voteKey}`;
}

function isLocallySubmitted(voteKey) {
  return localStorage.getItem(localVoteKey(voteKey)) === "true";
}

function markLocallySubmitted(voteKey) {
  localStorage.setItem(localVoteKey(voteKey), "true");
}

/* ------------------------------------------------------------
   참여 화면
   ------------------------------------------------------------ */

function renderJoinScreen(message = "") {
  progressArea.classList.add("hidden");
  studentIdentity.classList.add("hidden");

  studentApp.innerHTML = `
    <div class="centered-content">
      <span class="step-kicker">1단계 · 학급 참여</span>
      <h1>수업에 참여해 볼까요?</h1>
      <p>교사가 알려 준 학급 코드와 활동에서 사용할 별명을 입력하세요.</p>
    </div>

    ${message ? `<div class="notice-box">${escapeHtml(message)}</div>` : ""}

    <form id="joinForm" class="join-form">
      <div class="field-group">
        <label for="joinClassCode">학급 코드</label>
        <input
          id="joinClassCode"
          type="text"
          maxlength="6"
          value="${escapeHtml(classCode)}"
          placeholder="예: A1B2C3"
          required
          autocomplete="off"
        />
      </div>

      <div class="field-group">
        <label for="joinNickname">별명</label>
        <input
          id="joinNickname"
          type="text"
          maxlength="12"
          value="${escapeHtml(nickname)}"
          placeholder="예: 파란고래"
          required
          autocomplete="off"
        />
        <small>실명 대신 수업에서 알아볼 수 있는 별명을 사용하세요.</small>
      </div>

      <button class="primary-button full-button" type="submit">
        활동 참여하기
      </button>
    </form>
  `;

  document.getElementById("joinForm").addEventListener("submit", joinClass);
}

/* 학급 코드가 실제로 존재하는지 확인한 후 참여 정보를 저장합니다. */
async function joinClass(event) {
  event.preventDefault();

  const codeInput = document.getElementById("joinClassCode");
  const nicknameInput = document.getElementById("joinNickname");

  const nextCode = normalizeClassCode(codeInput.value);
  const nextNickname = nicknameInput.value.trim();

  if (nextCode.length !== 6) {
    renderJoinScreen("학급 코드는 영문과 숫자 6자리로 입력해 주세요.");
    return;
  }

  if (nextNickname.length < 2) {
    renderJoinScreen("별명은 2글자 이상 입력해 주세요.");
    return;
  }

  studentApp.innerHTML = `
    <div class="loading-state">
      <div class="spinner" aria-hidden="true"></div>
      <p>학급을 확인하고 있습니다.</p>
    </div>
  `;

  try {
    const classSnapshot = await get(ref(db, `classes/${nextCode}/settings`));

    if (!classSnapshot.exists()) {
      renderJoinScreen("해당 학급 코드를 찾을 수 없습니다. 코드를 다시 확인해 주세요.");
      return;
    }

    classCode = nextCode;
    nickname = nextNickname;

    localStorage.setItem("newsVoteClassCode", classCode);
    localStorage.setItem("newsVoteNickname", nickname);

    await registerPresence();
    subscribeToClass();
  } catch (error) {
    console.error(error);
    renderJoinScreen(
      "학급에 연결하지 못했습니다. 인터넷 연결과 Firebase 설정을 확인해 주세요."
    );
  }
}

/* ------------------------------------------------------------
   접속 학생 수 처리
   ------------------------------------------------------------
   학생이 연결되면 presence에 기록하고, 브라우저 연결이 끊기면
   onDisconnect를 통해 자동 삭제합니다.
*/
async function registerPresence() {
  const presenceRef = ref(db, `classes/${classCode}/presence/${deviceId}`);

  await set(presenceRef, {
    nickname,
    joinedAt: serverTimestamp()
  });

  onDisconnect(presenceRef).remove();
  updateIdentity();
}

/* ------------------------------------------------------------
   학급 데이터 실시간 구독
   ------------------------------------------------------------ */

function subscribeToClass() {
  if (!classCode) {
    renderJoinScreen();
    return;
  }

  /* 이전 학급 구독이 있다면 해제합니다. */
  if (typeof classListenerStop === "function") {
    classListenerStop();
  }

  const classRef = ref(db, `classes/${classCode}`);

  classListenerStop = onValue(
    classRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        renderJoinScreen("학급 정보가 삭제되었거나 존재하지 않습니다.");
        return;
      }

      currentClassData = snapshot.val();
      renderCurrentStep();
    },
    (error) => {
      console.error(error);
      renderJoinScreen("학급 정보를 실시간으로 불러오지 못했습니다.");
    }
  );
}

/* ------------------------------------------------------------
   단계별 화면 렌더링
   ------------------------------------------------------------ */

function renderCurrentStep() {
  const settings = currentClassData?.settings || {};
  const step = Number(settings.currentStep) || 1;

  updateProgress(step);
  updateIdentity();

  switch (step) {
    case 1:
      renderWaitingForTeacherStart();
      break;
    case 2:
      renderNewsTitle(settings);
      break;
    case 3:
      renderVoteScreen("vote1", settings);
      break;
    case 4:
      renderWaitScreen("1차 투표가 끝났습니다.");
      break;
    case 5:
      renderCommentScreen(
        "학생을 비판하는 댓글",
        settings.studentComments || [],
        "다음 댓글들은 학생을 문제 삼는 의견들입니다."
      );
      break;
    case 6:
      renderVoteScreen("vote2", settings);
      break;
    case 7:
      renderWaitScreen("2차 투표가 끝났습니다.");
      break;
    case 8:
      renderCommentScreen(
        "학부모를 비판하는 댓글",
        settings.parentComments || [],
        "다음 댓글들은 학부모를 문제 삼는 의견들입니다."
      );
      break;
    case 9:
      renderVoteScreen("vote3", settings);
      break;
    case 10:
      renderComparisonScreen(settings);
      break;
    case 11:
      renderVideoScreen(settings);
      break;
    case 12:
      renderVoteScreen("final", settings);
      break;
    case 13:
      renderReflectionScreen();
      break;
    default:
      renderWaitScreen("교사가 활동을 준비하고 있습니다.");
  }
}

/* 교사가 아직 첫 단계를 넘기지 않은 상태 */
function renderWaitingForTeacherStart() {
  studentApp.innerHTML = `
    <div class="centered-content">
      <span class="step-kicker">참여 완료</span>
      <div class="waiting-visual" aria-hidden="true">⏳</div>
      <h1>수업 시작을 기다려 주세요.</h1>
      <p>교사가 활동을 시작하면 화면이 자동으로 바뀝니다.</p>
    </div>
  `;
}

/* 2단계: 뉴스 제목만 표시 */
function renderNewsTitle(settings) {
  const title = settings.newsTitle || "교사가 뉴스 제목을 입력하고 있습니다.";

  studentApp.innerHTML = `
    <span class="step-kicker">2단계 · 뉴스 제목 확인</span>
    <h1>제목만 보고 생각해 봅시다.</h1>
    <p>아직 댓글이나 뉴스 영상은 보지 않습니다.</p>

    <div class="news-title-box">
      <blockquote>${escapeHtml(title)}</blockquote>
    </div>

    <div class="notice-box">
      지금 가진 정보만으로 누가 가장 문제라고 생각하는지 잠시 생각해 보세요.
    </div>

    <p class="teacher-wait-note">교사가 1차 투표를 시작하면 화면이 자동으로 바뀝니다.</p>
  `;
}

/* 대기 단계 */
function renderWaitScreen(title) {
  studentApp.innerHTML = `
    <div class="centered-content">
      <span class="step-kicker">잠시 대기</span>
      <div class="waiting-visual" aria-hidden="true">✅</div>
      <h1>${escapeHtml(title)}</h1>
      <p>교사가 다음 단계로 이동할 때까지 기다려 주세요.</p>
    </div>
  `;
}

/* 댓글 카드 표시 단계 */
function renderCommentScreen(title, commentsObject, description) {
  /*
    Firebase에서 배열이 객체처럼 전달되는 경우가 있어 Object.values를 사용합니다.
  */
  const comments = Array.isArray(commentsObject)
    ? commentsObject
    : Object.values(commentsObject || {});

  const cards = comments
    .slice(0, 4)
    .map(
      (comment) => `
        <article class="comment-card">
          <p>${escapeHtml(comment || "댓글이 아직 입력되지 않았습니다.")}</p>
        </article>
      `
    )
    .join("");

  studentApp.innerHTML = `
    <span class="step-kicker">댓글 읽기</span>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>

    <div class="comment-grid">
      ${cards || "<p>교사가 댓글을 입력하고 있습니다.</p>"}
    </div>

    <div class="notice-box">
      댓글은 뉴스의 사실을 그대로 보여주는 자료일까요, 아니면 누군가의 의견일까요?
    </div>

    <p class="teacher-wait-note">댓글을 모두 읽고 다음 투표를 기다려 주세요.</p>
  `;
}

/* ------------------------------------------------------------
   투표 화면
   ------------------------------------------------------------ */

function getVoteQuestion(voteKey) {
  if (voteKey === "vote1") {
    return "이 뉴스에서 누가 가장 문제라고 생각하나요?";
  }

  if (voteKey === "vote2" || voteKey === "vote3") {
    return "댓글을 읽은 뒤, 누가 가장 문제라고 생각하나요?";
  }

  return "뉴스 전체를 본 뒤, 어떻게 판단하나요?";
}

function getVoteStageLabel(voteKey) {
  const labels = {
    vote1: "1차 투표",
    vote2: "2차 투표",
    vote3: "3차 투표",
    final: "최종 투표"
  };

  return labels[voteKey];
}

async function renderVoteScreen(voteKey, settings) {
  const voteOpen = settings.voteOpen === true;
  const databaseVoteRef = ref(
    db,
    `classes/${classCode}/votes/${voteKey}/${deviceId}`
  );

  /*
    localStorage뿐 아니라 Firebase에도 이미 투표가 있는지 확인합니다.
    localStorage가 지워졌더라도 같은 기기 ID로 중복 제출되지 않게 합니다.
  */
  let submitted = isLocallySubmitted(voteKey);
  let submittedChoice = "";

  try {
    const voteSnapshot = await get(databaseVoteRef);

    if (voteSnapshot.exists()) {
      submitted = true;
      submittedChoice = voteSnapshot.val().choice || "";
      markLocallySubmitted(voteKey);
    }
  } catch (error) {
    console.error(error);
  }

  if (submitted) {
    renderSubmittedVote(voteKey, submittedChoice);
    return;
  }

  const options = VOTE_OPTIONS[voteKey];

  studentApp.innerHTML = `
    <span class="step-kicker">${getVoteStageLabel(voteKey)}</span>
    <h1>${escapeHtml(getVoteQuestion(voteKey))}</h1>
    <p>가장 가까운 생각 하나를 선택하세요. 제출한 뒤에는 수정할 수 없습니다.</p>

    ${
      voteOpen
        ? `
          <div id="choiceGrid" class="choice-grid">
            ${options
              .map(
                (option, index) => `
                  <button
                    class="choice-card"
                    type="button"
                    data-choice="${escapeHtml(option)}"
                    aria-pressed="false"
                  >
                    <span class="choice-marker">${index + 1}</span>
                    <span>${escapeHtml(option)}</span>
                  </button>
                `
              )
              .join("")}
          </div>

          <div class="vote-submit-row">
            <button id="submitVoteButton" class="primary-button" type="button" disabled>
              투표 제출
            </button>
          </div>
        `
        : `
          <div class="notice-box">
            교사가 아직 투표를 시작하지 않았습니다. 화면이 자동으로 바뀔 때까지 기다려 주세요.
          </div>
        `
    }
  `;

  if (!voteOpen) return;

  let selectedChoice = "";

  document.querySelectorAll(".choice-card").forEach((button) => {
    button.addEventListener("click", () => {
      selectedChoice = button.dataset.choice;

      document.querySelectorAll(".choice-card").forEach((item) => {
        const selected = item === button;
        item.classList.toggle("selected", selected);
        item.setAttribute("aria-pressed", String(selected));
      });

      document.getElementById("submitVoteButton").disabled = false;
    });
  });

  document
    .getElementById("submitVoteButton")
    .addEventListener("click", async () => {
      await submitVote(voteKey, selectedChoice);
    });
}

/* 투표를 Firebase에 저장합니다. 별명은 저장하지 않아 개별 응답 노출을 줄입니다. */
async function submitVote(voteKey, choice) {
  if (!choice) return;

  const submitButton = document.getElementById("submitVoteButton");
  submitButton.disabled = true;
  submitButton.textContent = "제출 중...";

  const voteRef = ref(
    db,
    `classes/${classCode}/votes/${voteKey}/${deviceId}`
  );

  try {
    const existingSnapshot = await get(voteRef);

    if (existingSnapshot.exists()) {
      markLocallySubmitted(voteKey);
      renderSubmittedVote(voteKey, existingSnapshot.val().choice || "");
      return;
    }

    await set(voteRef, {
      choice,
      submittedAt: serverTimestamp()
    });

    markLocallySubmitted(voteKey);
    renderSubmittedVote(voteKey, choice);
  } catch (error) {
    console.error(error);
    submitButton.disabled = false;
    submitButton.textContent = "투표 제출";
    alert("투표를 저장하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
  }
}

/* 제출 후에는 선택 버튼을 다시 보여주지 않아 수정할 수 없게 합니다. */
function renderSubmittedVote(voteKey, choice) {
  studentApp.innerHTML = `
    <div class="centered-content">
      <span class="step-kicker">${getVoteStageLabel(voteKey)} 완료</span>
      <div class="waiting-visual" aria-hidden="true">🗳️</div>
      <h1>투표가 제출되었습니다.</h1>
      <div class="success-box">
        선택한 응답: ${escapeHtml(choice || "제출 완료")}
        <br />
        제출한 투표는 수정할 수 없습니다.
      </div>
      <p>교사가 다음 단계로 이동할 때까지 기다려 주세요.</p>
    </div>
  `;
}

/* ------------------------------------------------------------
   10단계: 1·2·3차 결과 비교
   ------------------------------------------------------------ */

function countVotes(voteObject, labels) {
  const counts = Object.fromEntries(labels.map((label) => [label, 0]));

  Object.values(voteObject || {}).forEach((vote) => {
    if (vote?.choice in counts) {
      counts[vote.choice] += 1;
    }
  });

  return labels.map((label) => counts[label]);
}

function renderComparisonScreen(settings) {
  if (settings.resultsVisible !== true) {
    studentApp.innerHTML = `
      <div class="centered-content">
        <span class="step-kicker">10단계 · 결과 비교</span>
        <div class="waiting-visual" aria-hidden="true">📊</div>
        <h1>결과 공개를 기다리고 있습니다.</h1>
        <p>교사가 결과를 공개하면 1·2·3차 투표를 비교할 수 있습니다.</p>
      </div>
    `;
    return;
  }

  const labels = VOTE_OPTIONS.vote1;
  const votes = currentClassData?.votes || {};
  const vote1 = countVotes(votes.vote1, labels);
  const vote2 = countVotes(votes.vote2, labels);
  const vote3 = countVotes(votes.vote3, labels);

  studentApp.innerHTML = `
    <span class="step-kicker">10단계 · 결과 비교</span>
    <h1>우리 반의 판단은 어떻게 달라졌을까요?</h1>

    <div class="big-message">
      뉴스 내용은 달라지지 않았습니다.<br />
      여러분이 본 댓글만 달라졌습니다.
    </div>

    <div class="chart-container">
      <canvas id="studentComparisonChart" aria-label="1차, 2차, 3차 투표 비교 그래프"></canvas>
    </div>
  `;

  const canvas = document.getElementById("studentComparisonChart");

  if (studentChart) {
    studentChart.destroy();
  }

  studentChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "1차 투표",
          data: vote1,
          backgroundColor: "rgba(109, 63, 192, 0.78)"
        },
        {
          label: "2차 투표",
          data: vote2,
          backgroundColor: "rgba(40, 145, 120, 0.78)"
        },
        {
          label: "3차 투표",
          data: vote3,
          backgroundColor: "rgba(222, 132, 54, 0.78)"
        }
      ]
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
          position: "bottom"
        }
      }
    }
  });
}

/* ------------------------------------------------------------
   11단계: 유튜브 뉴스 영상
   ------------------------------------------------------------ */

function renderVideoScreen(settings) {
  const videoId = String(settings.youtubeId || "").trim();
  const safeVideoId = videoId.replace(/[^a-zA-Z0-9_-]/g, "");

  studentApp.innerHTML = `
    <span class="step-kicker">11단계 · 뉴스 전체 보기</span>
    <h1>이제 뉴스 영상을 확인해 봅시다.</h1>
    <p>제목과 댓글뿐 아니라 뉴스가 제공하는 전체 정보를 살펴보세요.</p>

    ${
      safeVideoId
        ? `
          <div class="video-wrapper">
            <iframe
              src="https://www.youtube.com/embed/${safeVideoId}"
              title="뉴스 영상"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
            ></iframe>
          </div>
        `
        : `
          <div class="notice-box">
            교사가 아직 유튜브 영상 ID를 입력하지 않았습니다.
          </div>
        `
    }
  `;
}

/* ------------------------------------------------------------
   13단계: 성찰 활동
   ------------------------------------------------------------ */

async function renderReflectionScreen() {
  const reflectionRef = ref(
    db,
    `classes/${classCode}/reflections/${deviceId}`
  );

  let alreadySubmitted = false;

  try {
    const snapshot = await get(reflectionRef);
    alreadySubmitted = snapshot.exists();
  } catch (error) {
    console.error(error);
  }

  if (alreadySubmitted) {
    renderReflectionComplete();
    return;
  }

  studentApp.innerHTML = `
    <span class="step-kicker">13단계 · 성찰 활동</span>
    <h1>내 판단이 어떻게 만들어졌는지 돌아봅시다.</h1>
    <p>정답을 찾는 활동이 아니라, 내 생각이 변한 과정을 살펴보는 활동입니다.</p>

    <form id="reflectionForm" class="reflection-form">
      <div class="reflection-item">
        <label for="changeCount">1. 내 생각은 몇 번 바뀌었나요?</label>
        <select id="changeCount" required>
          <option value="">선택하세요.</option>
          <option value="0번">0번</option>
          <option value="1번">1번</option>
          <option value="2번">2번</option>
          <option value="3번 이상">3번 이상</option>
        </select>
      </div>

      <div class="reflection-item">
        <label for="changeReason">2. 생각이 바뀐 가장 큰 이유는 무엇인가요?</label>
        <textarea id="changeReason" rows="3" required></textarea>
      </div>

      <div class="reflection-item">
        <label for="commentNature">3. 댓글은 사실인가요, 의견인가요?</label>
        <textarea id="commentNature" rows="3" required></textarea>
      </div>

      <div class="reflection-item">
        <label for="futureCheck">4. 앞으로 뉴스를 볼 때 무엇을 먼저 확인해야 할까요?</label>
        <textarea id="futureCheck" rows="3" required></textarea>
      </div>

      <button class="primary-button full-button" type="submit">
        성찰 내용 제출
      </button>
    </form>
  `;

  document
    .getElementById("reflectionForm")
    .addEventListener("submit", submitReflection);
}

async function submitReflection(event) {
  event.preventDefault();

  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "제출 중...";

  const reflectionData = {
    changeCount: document.getElementById("changeCount").value,
    changeReason: document.getElementById("changeReason").value.trim(),
    commentNature: document.getElementById("commentNature").value.trim(),
    futureCheck: document.getElementById("futureCheck").value.trim(),
    submittedAt: serverTimestamp()
  };

  try {
    await set(
      ref(db, `classes/${classCode}/reflections/${deviceId}`),
      reflectionData
    );

    renderReflectionComplete();
  } catch (error) {
    console.error(error);
    submitButton.disabled = false;
    submitButton.textContent = "성찰 내용 제출";
    alert("성찰 내용을 저장하지 못했습니다. 다시 시도해 주세요.");
  }
}

function renderReflectionComplete() {
  studentApp.innerHTML = `
    <div class="centered-content">
      <span class="step-kicker">활동 완료</span>
      <div class="waiting-visual" aria-hidden="true">🌱</div>
      <h1>수고했습니다!</h1>
      <p>나의 판단이 어떤 정보의 영향을 받았는지 기억해 주세요.</p>
    </div>

    <div class="education-guide">
      <article>
        “이번 활동에서는 댓글이 판단에 미치는 영향을 알아보기 위해
        특정 대상을 비판하는 댓글만 의도적으로 골라 보여주었습니다.”
      </article>

      <article>
        “댓글은 다른 사람의 의견입니다.
        뉴스의 전체 내용을 확인한 뒤 자신의 판단을 만들어야 합니다.”
      </article>
    </div>
  `;
}

/* ------------------------------------------------------------
   앱 시작
   ------------------------------------------------------------ */

async function startStudentApp() {
  /*
    이전에 참여한 학급 정보가 있으면 자동 재접속을 시도합니다.
    학급이 없거나 오류가 나면 참여 화면을 보여줍니다.
  */
  if (!classCode || !nickname) {
    renderJoinScreen();
    return;
  }

  try {
    const snapshot = await get(ref(db, `classes/${classCode}/settings`));

    if (!snapshot.exists()) {
      renderJoinScreen("이전에 참여한 학급을 찾을 수 없습니다. 다시 입력해 주세요.");
      return;
    }

    await registerPresence();
    subscribeToClass();
  } catch (error) {
    console.error(error);
    renderJoinScreen("자동 연결에 실패했습니다. 학급 정보를 다시 입력해 주세요.");
  }
}

startStudentApp();
