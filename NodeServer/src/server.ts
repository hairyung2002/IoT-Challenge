import express, { Request, Response } from "express";
import axios from "axios";
import bodyParser from "body-parser";
import cors from "cors";

// ==========================================
// [Type Definitions] 데이터 구조 정의
// ==========================================

// 1. 센서 데이터 구조 (진동, 기울기, 소리)
interface SensorData {
  nodeId?: string; // 노드 식별자 (없으면 node-1)
  temp: number; // 온도 (섭씨)
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

// 3. 노드별 위험도 구조
interface NodeRisk {
  id: string;
  level: RiskLevel;
  score: number;
  message: string;
  data: SensorData | null;
  timestamp: string;
}

// 4. 현재 서버 상태 (리액트가 가져갈 데이터 구조)
interface CurrentState {
  level: RiskLevel; // 종합 위험도 레벨
  message: string; // 종합 메시지
  overallScore: number; // 종합 점수 0~100
  timestamp: string;
  data: SensorData | null;
  nodes: NodeRisk[]; // 노드별 상세
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
const MOBIUS_ENABLED = process.env.MOBIUS_ENABLED === "true";

// 위험도 임계값 설정 (필요시 환경변수로 조정)
const RISK_THRESHOLD = {
  dangerTemp: Number(process.env.DANGER_TEMP || 60), // 고열 시 즉시 위험
  dangerGyr: Number(process.env.DANGER_GYR || 50),
  warningTemp: Number(process.env.WARNING_TEMP || 45),
  warningGyr: Number(process.env.WARNING_GYR || 15),
};

// ==========================================
// [전역 변수] 현재 현장 상태 저장소
// ==========================================
// 리액트가 "/status"를 호출하면 이 변수를 보내줍니다.
let currentStatus: CurrentState = {
  level: "SAFE",
  message: "현장이 안정적입니다.",
  overallScore: 20,
  timestamp: new Date().toLocaleTimeString(),
  data: null,
  nodes: [],
};

// 노드 상태 보관용 맵
const nodeStore = new Map<string, NodeRisk>();

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
    const nodeId = String((obj as any).nodeId || "node-1");
    const temp = Number((obj as any).temp);
    const gyr = Number((obj as any).gyr);
    const snd = String((obj as any).snd || "");
    if (Number.isNaN(temp) || Number.isNaN(gyr)) return null;
    return { nodeId, temp, gyr, snd };
  } catch {
    return null;
  }
}

async function sendCommand(cmd: CommandPayload) {
  if (!MOBIUS_ENABLED) return;
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
  if (!MOBIUS_ENABLED) return;
  if (status.level === "DANGER") {
    await sendCommand({ level: "HIGH", siren: true, nodeId: "N1", ts: Date.now() });
  } else if (status.level === "WARNING") {
    await sendCommand({ level: "MID", siren: false, nodeId: "N1", ts: Date.now() });
  }
}

// ==========================================
// [핵심 로직] 위험도 분석 함수
// ==========================================
function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

// 노드별 위험 평가 (가중치 기반)
// 기울기는 절대 각도(gyr)뿐 아니라 직전 대비 변화량(gyrDelta)을 반영
function evaluateNode(sensorData: SensorData, prev?: NodeRisk): NodeRisk {
  const sndScore = sensorData.snd === "crash" ? 95 : sensorData.snd === "crack" ? 65 : 10;
  const tempScore = clamp(sensorData.temp, 0, 100);

  const prevGyr = prev?.data?.gyr ?? sensorData.gyr;
  const gyrDelta = Math.abs(sensorData.gyr - prevGyr);

  const gyrScore = clamp(sensorData.gyr * 2, 0, 100); // 50도면 100점 환산
  const deltaScore = clamp(gyrDelta * 4, 0, 100); // 변화량 25도 ≈ 100점

  // 가중치: 온도 35%, 기울기 절대값 30%, 기울기 변화량 20%, 소리 15%
  const weighted = tempScore * 0.35 + gyrScore * 0.3 + deltaScore * 0.2 + sndScore * 0.15;
  const score = Math.round(weighted);

  let level: RiskLevel = "SAFE";
  if (score >= 75) level = "DANGER";
  else if (score >= 45) level = "WARNING";

  const msg =
    level === "DANGER"
      ? "🚨 붕괴 징후 감지! 즉시 대피"
      : level === "WARNING"
      ? "⚠️ 진동/기울기 이상, 주의 필요"
      : "✅ 정상";

  return {
    id: sensorData.nodeId || "node-1",
    level,
    score,
    message: msg,
    data: sensorData,
    timestamp: new Date().toLocaleTimeString(),
  };
}

// 노드 상태 반영 후 종합 계산
function updateStateWithNode(node: NodeRisk) {
  nodeStore.set(node.id, node);
  const nodeList = Array.from(nodeStore.values());

  // 종합 레벨: DANGER > WARNING > SAFE (우선순위)
  let overallLevel: RiskLevel = "SAFE";
  if (nodeList.some((n) => n.level === "DANGER")) overallLevel = "DANGER";
  else if (nodeList.some((n) => n.level === "WARNING")) overallLevel = "WARNING";

  const overallScore = nodeList.length
    ? Math.round(nodeList.reduce((sum, n) => sum + n.score, 0) / nodeList.length)
    : 20;

  const latestNode = node; // 가장 최근 업데이트 노드

  currentStatus = {
    level: overallLevel,
    message:
      overallLevel === "DANGER"
        ? "🚨 다수 노드에서 붕괴 징후 감지"
        : overallLevel === "WARNING"
        ? "⚠️ 일부 노드 이상, 주의 필요"
        : "✅ 현장 안정",
    overallScore,
    timestamp: new Date().toLocaleTimeString(),
    data: latestNode?.data ?? null,
    nodes: nodeList,
  };
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

    // 위험도 평가 및 상태 갱신 (직전 상태 기반 기울기 변화량 반영)
    const prev = nodeStore.get(sensorData.nodeId || "node-1");
    const node = evaluateNode(sensorData, prev);
    updateStateWithNode(node);

    console.log(
      `📊 수신값: Temp=${sensorData.temp}, Gyr=${sensorData.gyr}, Snd=${sensorData.snd}`
    );
    console.log(
      `🛡️ 분석결과: [${node.level}] ${node.message} (score ${node.score})`
    );

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

  const prev = nodeStore.get(sensorData.nodeId || "node-1");
  const node = evaluateNode(sensorData, prev);
  updateStateWithNode(node);

  broadcastStatus();
  void maybeSendCommand(currentStatus);

  res.json(currentStatus);
});

// ==========================================
// [API] 2-3. 랜덤 데이터 자동 생성 시뮬레이터
// ==========================================
let randomSimInterval: NodeJS.Timeout | null = null;

function generateRandomSensorData(): SensorData {
  // 랜덤 진동값 (0~5, 가끔 스파이크 10까지)
  const vib = Math.random() < 0.1 
    ? Math.random() * 100 // 10% 확률로 높은 값 (위험 상황)
    : Math.random() * 30;  // 90% 확률로 낮은 값 (정상)
  
  // 랜덤 기울기 (0~60도)
  const gyr = Math.random() < 0.15
    ? Math.random() * 60  // 15% 확률로 높은 기울기
    : Math.random() * 20;  // 85% 확률로 정상 범위
  
  // 랜덤 소리 (quiet, crack, crash)
  const sndOptions = ["quiet", "quiet", "quiet", "quiet", "crack", "crash"];
  const snd = sndOptions[Math.floor(Math.random() * sndOptions.length)];
  
  // 온도는 20~80 사이 분포 (10% 확률로 급상승)
  const baseTemp = 20 + Math.random() * 20; // 20~40
  const spike = Math.random() < 0.1 ? 30 + Math.random() * 20 : 0; // 최대 +50
  const temp = baseTemp + spike;
  
  return { temp: Math.round(temp * 100) / 100, gyr: Math.round(gyr * 100) / 100, snd };
}

// 랜덤 시뮬레이션 시작
app.post("/simulate/start", (req, res) => {
  const interval = Number(req.query.interval) || 3000; // 기본 3초
  
  if (randomSimInterval) {
    clearInterval(randomSimInterval);
  }
  
  randomSimInterval = setInterval(() => {
    // 두 노드에 대해 각각 랜덤 생성 (이전 상태를 반영해 기울기 변화량 계산)
    ["node-1", "node-2"].forEach((id) => {
      const sensorData = { ...generateRandomSensorData(), nodeId: id };
      const prev = nodeStore.get(id);
      const node = evaluateNode(sensorData, prev);
      updateStateWithNode(node);
    });

    console.log(
      `🎲 [RANDOM] n1=${currentStatus.nodes.find((n) => n.id === "node-1")?.score ?? '-'} / n2=${currentStatus.nodes.find((n) => n.id === "node-2")?.score ?? '-'} → overall ${currentStatus.level} (${currentStatus.overallScore}점)`
    );
    broadcastStatus();
    void maybeSendCommand(currentStatus);
  }, interval);
  
  console.log(`🎮 랜덤 시뮬레이션 시작 (${interval}ms 간격)`);
  res.json({ status: "started", interval });
});

// 랜덤 시뮬레이션 중지
app.post("/simulate/stop", (req, res) => {
  if (randomSimInterval) {
    clearInterval(randomSimInterval);
    randomSimInterval = null;
    console.log("🛑 랜덤 시뮬레이션 중지");
    res.json({ status: "stopped" });
  } else {
    res.json({ status: "not running" });
  }
});

// 현재 시뮬레이션 상태 조회
app.get("/simulate/status", (req, res) => {
  res.json({ running: randomSimInterval !== null });
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