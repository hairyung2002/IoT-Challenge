export type RiskLevel = "SAFE" | "WARNING" | "DANGER";

export interface SensorData {
  vib: number; // 진동
  gyr: number; // 기울기
  snd: string; // 소리 이벤트
}

export interface StatusPayload {
  level: RiskLevel;
  message: string;
  timestamp: string;
  data: SensorData | null;
}

const API_BASE = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

export async function fetchStatus(): Promise<StatusPayload> {
  const res = await fetch(`${API_BASE}/status`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

/**
 * 폴링 방식으로 상태 구독
 * @param onMessage 데이터 수신 콜백
 * @param interval 폴링 간격 (ms), 기본 1000ms
 */
export function subscribeStatus(
  onMessage: (payload: StatusPayload) => void,
  interval = 1000
): () => void {
  let active = true;

  const poll = async () => {
    if (!active) return;
    try {
      const data = await fetchStatus();
      if (active) onMessage(data);
    } catch (e) {
      console.error("Polling error:", e);
    }
    if (active) setTimeout(poll, interval);
  };

  poll(); // 즉시 첫 호출

  return () => {
    active = false;
  };
}

export function computeRiskScore(data: SensorData | null, level: RiskLevel): number {
  if (!data) {
    if (level === "DANGER") return 85;
    if (level === "WARNING") return 65;
    return 20;
  }

  const sndScore = data.snd === "crash" ? 95 : data.snd === "crack" ? 70 : 10;
  const vibScore = Math.min(100, Math.max(0, data.vib));
  const gyrScore = Math.min(100, Math.max(0, data.gyr * 2));
  const base = Math.max(sndScore, vibScore, gyrScore);

  if (level === "DANGER") return Math.max(base, 82);
  if (level === "WARNING") return Math.max(base, 60);
  return Math.min(base, 40);
}

export function levelLabel(level: RiskLevel): string {
  switch (level) {
    case "DANGER":
      return "매우 위험";
    case "WARNING":
      return "주의";
    default:
      return "정상";
  }
}

export function levelColor(level: RiskLevel): string {
  switch (level) {
    case "DANGER":
      return "bg-red-600";
    case "WARNING":
      return "bg-orange-500";
    default:
      return "bg-lime-500";
  }
}

export function levelTextColor(level: RiskLevel): string {
  switch (level) {
    case "DANGER":
      return "text-red-600";
    case "WARNING":
      return "text-orange-500";
    default:
      return "text-lime-600";
  }
}