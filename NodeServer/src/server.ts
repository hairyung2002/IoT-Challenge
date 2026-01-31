import express, { Request, Response } from "express";
import axios from "axios";
import bodyParser from "body-parser";
import cors from "cors";

// ==========================================
// [Type Definitions] 데이터 구조 정의
// ==========================================

// 1. 센서 데이터 구조 (진동, 기울기, 소리)
interface SensorData {
  vib: number; // 진동 (0~100)
  gyr: number; // 기울기 (0~180도)
  snd: string; // 소리 ("quiet", "crack", "crash" 등)
}

// 2. 위험 등급 정의
type RiskLevel = "SAFE" | "WARNING" | "DANGER";

// 3. 현재 서버 상태 (리액트가 가져갈 데이터 구조)
interface CurrentState {
  level: RiskLevel;
  message: string;
  timestamp: string;
  data: SensorData | null;
}

// 4. Mobius 알림 구조 (oneM2M 표준)
interface OneM2MNotification {
  "m2m:sgn": {
    nev?: {
      rep?: {
        "m2m:cin"?: {
          con: string;
          ct: string;
        };
      };
    };
    sur?: string;
  };
}

// ==========================================
// [설정 영역]
// ==========================================
const PORT = 3000;

// Mobius 설정 (나중에 하드웨어 연결 시 사용)
const CSE_HOST = "203.253.128.161";
const CSE_PORT = 7579;
const CSE_NAME = "Mobius";
const AE_NAME = "ae-rescuer-safety";
const TARGET_CONTAINER_PATH = "/Mobius/cnt-sensor-raw";
const EXTERNAL_IP = "noncausative-bryson-overluxuriously.ngrok-free.dev";
const NOTIFICATION_URI = `https://${EXTERNAL_IP}/monitor`;

// ==========================================
// [전역 변수] 현재 현장 상태 저장소
// ==========================================
// 리액트가 "/status"를 호출하면 이 변수를 보내줍니다.
let currentStatus: CurrentState = {
  level: "SAFE",
  message: "현장이 안정적입니다.",
  timestamp: new Date().toLocaleTimeString(),
  data: null,
};

const app = express();

// 미들웨어 설정
app.use(cors());
app.use(
  bodyParser.json({
    type: [
      "application/json",
      "application/*+json",
      "application/vnd.onem2m-res+json",
    ],
  })
);

// ==========================================
// [핵심 로직] 위험도 분석 함수
// ==========================================
function analyzeRisk(data: SensorData): { level: RiskLevel; msg: string } {
  const { vib, gyr, snd } = data;

  // 1. [DANGER] 즉시 대피 상황 (수치는 임의로 설정, 추후 조정 가능)
  // - 진동이 80 이상이거나
  // - 기울기가 50도 이상 꺾였거나
  // - 붕괴음("crash")이 들릴 때
  if (vib >= 80 || gyr >= 50 || snd === "crash") {
    return { level: "DANGER", msg: "🚨 긴급 대피! 2차 붕괴 징후 감지!" };
  }

  // 2. [WARNING] 주의 요망
  // - 진동 30 이상 or 기울기 15도 이상 or 균열음("crack")
  if (vib >= 30 || gyr >= 15 || snd === "crack") {
    return { level: "WARNING", msg: "⚠️ 주의! 미세 진동 및 균열 감지." };
  }

  // 3. [SAFE] 안전
  return { level: "SAFE", msg: "✅ 현장 안전함. 구조 작업 가능." };
}

// ==========================================
// [API] 1. 모니터링 수신 (from Mobius or Curl)
// ==========================================
app.post("/monitor", (req: Request, res: Response) => {
  console.log("\n[📩 EVENT] 데이터 수신됨!");

  try {
    // Mobius 구조에서 'con' 값 추출
    const sgn = req.body["m2m:sgn"];
    const contentRaw = sgn?.nev?.rep?.["m2m:cin"]?.con;

    if (!contentRaw) {
      console.log("⚠️ 데이터 없음 (빈 요청)");
      res.status(400).send("No Content");
      return;
    }

    // 데이터 파싱: Mobius는 문자열로 보내고, 우리가 curl로 쏘면 JSON 객체일 수 있음
    let sensorData: SensorData;
    if (typeof contentRaw === "string") {
      sensorData = JSON.parse(contentRaw); // 문자열이면 JSON으로 변환
    } else {
      sensorData = contentRaw; // 이미 객체면 그대로 사용
    }

    // 위험도 분석 실행
    const result = analyzeRisk(sensorData);

    // 상태 업데이트 (전역 변수 갱신)
    currentStatus = {
      level: result.level,
      message: result.msg,
      timestamp: new Date().toLocaleTimeString(),
      data: sensorData,
    };

    console.log(
      `📊 수신값: Vib=${sensorData.vib}, Gyr=${sensorData.gyr}, Snd=${sensorData.snd}`
    );
    console.log(`🛡️ 분석결과: [${result.level}] ${result.msg}`);

    res.status(200).send("OK");
  } catch (e) {
    console.error("❌ 데이터 처리 실패:", e);
    res.status(500).send("Error");
  }
});

// ==========================================
// [API] 2. 리액트 대시보드용 상태 조회
// ==========================================
app.get("/status", (req, res) => {
  // 리액트가 1초마다 이 주소를 찔러서 현재 상태를 가져감
  res.json(currentStatus);
});

// ==========================================
// [API] 3. 기본 헬스 체크
// ==========================================
app.get("/", (req, res) => {
  res.send("🚑 구조대원 안전 분석 서버가 작동 중입니다.");
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`\n🚀 [Rescue Server] Port ${PORT} is Ready!`);
  console.log(`📡 데이터 수신 대기 중...`);
  console.log(`💻 React API 주소: http://localhost:${PORT}/status`);

  // Mobius 연동은 에러 나도 서버 안 꺼지게 예외처리 해둠
  setTimeout(initOneM2M, 1000);
});

// ==========================================
// [Mobius 초기화 (연결 실패해도 서버는 유지됨)]
// ==========================================
async function initOneM2M() {
  // ngrok 주소가 올바르지 않으면 그냥 패스합니다.
  if (EXTERNAL_IP.includes("xxxx") || !EXTERNAL_IP) {
    console.log("ℹ️ Mobius 연동 생략 (EXTERNAL_IP 미설정)");
    return;
  }

  const headersAE = {
    "X-M2M-RI": Date.now().toString(),
    "X-M2M-Origin": "S" + AE_NAME,
    "Content-Type": "application/json;ty=2",
  };
  const headersSub = {
    "X-M2M-RI": Date.now().toString(),
    "X-M2M-Origin": "S" + AE_NAME,
    "Content-Type": "application/json;ty=23",
  };

  try {
    console.log("1️⃣ Mobius AE 등록 시도...");
    await axios.post(
      `http://${CSE_HOST}:${CSE_PORT}/${CSE_NAME}`,
      {
        "m2m:ae": {
          rn: AE_NAME,
          api: "0.2.481.2.0001",
          rr: true,
          poa: [NOTIFICATION_URI],
        },
      },
      { headers: headersAE }
    ).catch((e) => { if (e.response?.status !== 409) throw e; });

    console.log("2️⃣ Subscription 생성 시도...");
    const subName = `sub-${AE_NAME}-${Date.now()}`;
    await axios.post(
      `http://${CSE_HOST}:${CSE_PORT}${TARGET_CONTAINER_PATH}`,
      {
        "m2m:sub": { rn: subName, enc: { net: [3] }, nu: [NOTIFICATION_URI] },
      },
      { headers: headersSub }
    ).catch((e) => {
      if (e.response?.status === 404) console.log("⚠️ 센서 컨테이너 없음 (정상)");
    });

    console.log("✅ Mobius 설정 완료!");
  } catch (e: any) {
    console.log("ℹ️ Mobius 연결 실패 (로컬 테스트 모드로 동작합니다)");
  }
}