/*
  ============================================================
  Firebase 공통 설정 파일
  ============================================================

  1. Firebase 콘솔에서 새 프로젝트를 만듭니다.
  2. Realtime Database를 생성합니다.
  3. 웹 앱을 추가한 뒤 제공되는 firebaseConfig 값을 아래에 붙여 넣습니다.
  4. 이 파일은 student.js와 teacher.js에서 함께 사용합니다.

  주의:
  아래 값은 예시이므로 반드시 본인의 Firebase 프로젝트 값으로 바꾸어야 합니다.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  update,
  get,
  remove,
  onValue,
  onDisconnect,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js";

/* Firebase 콘솔에서 복사한 설정값을 입력하세요. */
const firebaseConfig = {
  apiKey: "AIzaSyCQIl_TXTSQVkyhAWR9XmWG1gRz_6KBBzU",
  authDomain: "metalk-live.firebaseapp.com",
  databaseURL: "https://metalk-live-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "metalk-live",
  storageBucket: "metalk-live.firebasestorage.app",
  messagingSenderId: "321336664704",
  appId: "1:321336664704:web:191d36e83a08b2f4273c65",
  measurementId: "G-03L922NC5M"
};

/* Firebase 앱과 Realtime Database를 초기화합니다. */
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

/*
  다른 JavaScript 파일에서 필요한 Firebase 기능을 가져다 쓸 수 있도록
  모두 export 합니다.
*/
export {
  db,
  ref,
  set,
  update,
  get,
  remove,
  onValue,
  onDisconnect,
  serverTimestamp
};
