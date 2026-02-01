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

interface CommandPayload {
  level: "LOW" | "MID" | "HIGH";
  siren: boolean;
  nodeId: string;
  ts: number;
}

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
const PORT = Number(process.env.PORT) || 3000;

// Mobius 설정 (환경변수 우선)
const CSE_HOST = process.env.CSE_HOST || "203.253.128.161";
const CSE_PORT = Number(process.env.CSE_PORT) || 7579;
const CSE_NAME = process.env.CSE_NAME || "Mobius";
const AE_NAME = process.env.AE_NAME || "ae-rescuer-safety";
const TARGET_CONTAINER_PATH = process.env.TARGET_CONTAINER_PATH || "/Mobius/cnt-sensor-raw";
const COMMAND_CONTAINER_PATH = process.env.COMMAND_CONTAINER_PATH || "/Mobius/cnt-cmd";
const EXTERNAL_IP = process.env.EXTERNAL_IP || "noncausative-bryson-overluxuriously.ngrok-free.dev";
const NOTIFICATION_URI = `https://${EXTERNAL_IP}/monitor`;

// 위험도 임계값 설정 (필요시 환경변수로 조정)
const RISK_THRESHOLD = {
  dangerVib: Number(process.env.DANGER_VIB || 80),
  dangerGyr: Number(process.env.DANGER_GYR || 50),
  warningVib: Number(process.env.WARNING_VIB || 30),
  warningGyr: Number(process.env.WARNING_GYR || 15),
};

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

// SSE 구독자 목록
const sseClients = new Set<Response>();

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

// 프로세스 에러 핸들링: 갑작스런 종료 방지
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION", err);
});

// SSE 브로드캐스트: 상태 변경 시 모든 구독자에게 push
function broadcastStatus() {
  const payload = `data: ${JSON.stringify(currentStatus)}\n\n`;
  sseClients.forEach((client) => {
    client.write(payload);
  });
}

// 간단한 입력 검증
function parseSensorData(contentRaw: unknown): SensorData | null {
  if (!contentRaw) return null;
  try {
    const obj = typeof contentRaw === "string" ? JSON.parse(contentRaw) : contentRaw;
    if (typeof obj !== "object" || obj === null) return null;
    const vib = Number((obj as any).vib);
    const gyr = Number((obj as any).gyr);
    const snd = String((obj as any).snd || "");
    if (Number.isNaN(vib) || Number.isNaN(gyr)) return null;
    return { vib, gyr, snd };
  } catch {
    return null;
  }
}

async function sendCommand(cmd: CommandPayload) {
  const headers = {
    "X-M2M-RI": Date.now().toString(),
    "X-M2M-Origin": "S" + AE_NAME,
    "Content-Type": "application/json;ty=4",
  };

  try {
    await axios.post(
      `http://${CSE_HOST}:${CSE_PORT}${COMMAND_CONTAINER_PATH}`,
      { "m2m:cin": { con: JSON.stringify(cmd) } },
      { headers }
    );
    console.log(`📡 Mobius로 명령 전송: ${JSON.stringify(cmd)}`);
  } catch (e) {
    console.log("⚠️ Mobius 명령 전송 실패 (무시하고 계속 진행)", (e as Error).message);
  }
}

async function maybeSendCommand(status: CurrentState) {
  if (status.level === "DANGER") {
    await sendCommand({ level: "HIGH", siren: true, nodeId: "N1", ts: Date.now() });
  } else if (status.level === "WARNING") {
    await sendCommand({ level: "MID", siren: false, nodeId: "N1", ts: Date.now() });
  }
}

// ==========================================
// [핵심 로직] 위험도 분석 함수
// ==========================================
function analyzeRisk(data: SensorData): { level: RiskLevel; msg: string } {
  const { vib, gyr, snd } = data;

  // 1. [DANGER] 즉시 대피 상황 (수치는 임의로 설정, 추후 조정 가능)
  // - 진동이 80 이상이거나
  // - 기울기가 50도 이상 꺾였거나
  // - 붕괴음("crash")이 들릴 때
  if (vib >= RISK_THRESHOLD.dangerVib || gyr >= RISK_THRESHOLD.dangerGyr || snd === "crash") {
    return { level: "DANGER", msg: "🚨 긴급 대피! 2차 붕괴 징후 감지!" };
  }

  // 2. [WARNING] 주의 요망
  // - 진동 30 이상 or 기울기 15도 이상 or 균열음("crack")
  if (vib >= RISK_THRESHOLD.warningVib || gyr >= RISK_THRESHOLD.warningGyr || snd === "crack") {
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

    const sensorData = parseSensorData(contentRaw ?? req.body);
    if (!sensorData) {
      console.log("⚠️ 데이터 없음 (빈 요청)");
      res.status(400).send("No Content");
      return;
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

    broadcastStatus();
    void maybeSendCommand(currentStatus);

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
// [API] 2-1. 실시간 SSE 스트림 (폴링 대체)
// ==========================================
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // 초기 상태 전송
  res.write(`data: ${JSON.stringify(currentStatus)}\n\n`);
  sseClients.add(res);

  const keepAlive = setInterval(() => {
    res.write(":ping\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// ==========================================
// [API] 2-2. 로컬 시뮬레이터 입력 (하드웨어 없이 테스트)
// ==========================================
app.post("/simulate", (req, res) => {
  console.log("[SIM] /simulate 호출");
  const sensorData = parseSensorData(req.body);
  if (!sensorData) return res.status(400).json({ error: "invalid payload" });

  const result = analyzeRisk(sensorData);
  currentStatus = {
    level: result.level,
    message: result.msg,
    timestamp: new Date().toLocaleTimeString(),
    data: sensorData,
  };

  broadcastStatus();
  void maybeSendCommand(currentStatus);

  res.json(currentStatus);
});

// ==========================================
// [API] 3. 기본 헬스 체크
// ==========================================
app.get("/", (req, res) => {
  res.send("🚑 구조대원 안전 분석 서버가 작동 중입니다.");
});

// 서버 시작
const server = app.listen(PORT, () => {
  console.log(`\n🚀 [Rescue Server] Port ${PORT} is Ready!`);
  console.log(`📡 데이터 수신 대기 중...`);
  console.log(`💻 React API 주소: http://localhost:${PORT}/status`);

  // Mobius 연동은 에러 나도 서버 안 꺼지게 예외처리 해둠
  setTimeout(initOneM2M, 1000);
});

server.on("error", (err) => {
  console.error("HTTP 서버 오류", err);
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

  const headersCnt = {
    "X-M2M-RI": Date.now().toString(),
    "X-M2M-Origin": "S" + AE_NAME,
    "Content-Type": "application/json;ty=3",
  };

  const ensureContainer = async (containerPath: string, label: string) => {
    const idx = containerPath.lastIndexOf("/");
    if (idx <= 0) {
      console.log(`⚠️ 컨테이너 경로가 올바르지 않습니다: ${containerPath}`);
      return;
    }
    const parent = containerPath.substring(0, idx);
    const name = containerPath.substring(idx + 1);
    try {
      await axios.post(
        `http://${CSE_HOST}:${CSE_PORT}${parent}`,
        { "m2m:cnt": { rn: name, lbl: [label] } },
        { headers: headersCnt }
      );
      console.log(`📁 컨테이너 생성 완료: ${containerPath}`);
    } catch (e: any) {
      if (e.response?.status === 409) {
        console.log(`ℹ️ 컨테이너 이미 존재: ${containerPath}`);
      } else {
        console.log(`⚠️ 컨테이너 생성 실패 (${containerPath})`, e.message);
      }
    }
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

    console.log("2️⃣ 센서/명령 컨테이너 생성 시도...");
    await ensureContainer(TARGET_CONTAINER_PATH, "sensor");
    await ensureContainer(COMMAND_CONTAINER_PATH, "command");

    console.log("3️⃣ Subscription 생성 시도...");
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