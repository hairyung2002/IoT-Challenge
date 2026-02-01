import './App.css'
import { useEffect, useMemo, useState } from 'react'
import {
  fetchStatus,
  subscribeStatus,
  computeRiskScore,
  levelLabel,
  levelColor,
  levelTextColor,
  type StatusPayload,
} from './api'

function App() {
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'open' | 'error'>('connecting')
  const [vibHistory, setVibHistory] = useState<number[]>([])
  const [sndHistory, setSndHistory] = useState<number[]>([])
  const [lastPollTime, setLastPollTime] = useState<string>('--:--:--')

  useEffect(() => {
    let mounted = true

    // 폴링 방식으로 1초마다 상태 갱신
    const unsubscribe = subscribeStatus((data) => {
      if (!mounted) return
      setConnection('open')
      setStatus(data)
      // 폴링 시간 기록 (HH:MM:SS 형식)
      const now = new Date()
      setLastPollTime(now.toLocaleTimeString('ko-KR', { hour12: false }))
      if (data.data) {
        setVibHistory((prev) => [...prev.slice(-29), data.data!.vib])
        const sndNum = parseFloat(data.data!.snd) || 0
        setSndHistory((prev) => [...prev.slice(-29), sndNum])
      }
    }, 5000) // 5초 간격 폴링

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const riskScore = useMemo(() => Math.round(computeRiskScore(status?.data ?? null, status?.level ?? 'SAFE')), [status])
  const node1Score = useMemo(() => Math.round(computeRiskScore(status?.data ?? null, status?.level ?? 'SAFE')), [status])
  const node2Score = 72 // placeholder for future node

  const sndText = status?.data?.snd ?? '--'
  const sndNum = parseFloat(status?.data?.snd ?? '0') || 0
  const vibVal = status?.data?.vib ?? 0
  const vibText = status?.data ? `${status.data.vib.toFixed(2)} g` : '--'
  const gyrVal = status?.data?.gyr ?? 0
  const gyrText = status?.data ? `${status.data.gyr.toFixed(1)}°` : '--'
  const maxVib = vibHistory.length > 0 ? Math.max(...vibHistory) : vibVal
  const maxSnd = sndHistory.length > 0 ? Math.max(...sndHistory) : sndNum
  const level = status?.level ?? 'SAFE'
  const levelChip = levelLabel(level)
  const levelColorClass = levelColor(level)
  const levelTextClass = levelTextColor(level)

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-200 p-4 text-stone-900">
      <div className="relative h-[832px] w-[1280px] overflow-hidden bg-zinc-200">
        {/* 헤더 */}
        <div className="absolute left-[27px] top-[26px] text-3xl font-medium leading-[48px]">DASHBOARD</div>
        <div className="absolute left-[10px] top-[98px] inline-flex items-center gap-2.5 rounded-full bg-white px-3 py-1 shadow-sm">
          <div className={`h-3 w-3 rounded-full ${connection === 'open' ? 'bg-lime-500' : connection === 'error' ? 'bg-red-500' : 'bg-amber-400'}`} />
          <div className="text-lg leading-7">마지막 업데이트 : {lastPollTime}</div>
        </div>

        {/* 노드 선택 */}
        <div className="absolute left-[10px] top-[143px] inline-flex w-[607px] items-center gap-6 rounded-[20px] bg-white p-6 shadow-sm">
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex-1 text-base font-medium leading-6">노드 선택</div>
            </div>
            <div className="flex gap-2.5">
              <div className="flex flex-1 items-center gap-2" data-status="Checked">
                <div className="flex h-6 w-6 items-center justify-center">
                  <div className="h-5 w-5 bg-stone-800" />
                </div>
                <div className="text-sm font-semibold leading-5 text-stone-700">노드 1</div>
              </div>
              <div className="flex flex-1 items-center gap-2" data-status="Unchecked">
                <div className="h-6 w-6">
                  <div className="relative h-full w-full">
                    <div className="absolute left-[2px] top-[2px] h-5 w-5 bg-stone-500" />
                  </div>
                </div>
                <div className="text-sm font-medium leading-5 text-stone-500">노드 2</div>
              </div>
            </div>
          </div>
        </div>

        {/* 좌측 스택: 진동, 음성, 자이로 */}
        <div className="absolute left-[10px] top-[265px] flex h-[557px] w-[607px] flex-col gap-2.5">
          {/* 진동 */}
          <div className="flex flex-1 flex-col gap-2 overflow-hidden rounded-[20px] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-2.5">
              <div className="text-base font-medium leading-6 text-stone-900">진동</div>
              <div className="text-sm leading-5 text-stone-300">노드 1</div>
            </div>
            {/* ECG 스타일 파형 */}
            <div className="relative flex-1 overflow-hidden">
              <svg className="h-full w-full" viewBox="0 0 560 70" preserveAspectRatio="none">
                <polyline
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="1.5"
                  points={(() => {
                    const data = vibHistory.length > 0 ? vibHistory : Array(30).fill(0.2)
                    const width = 560
                    const height = 70
                    const mid = height / 2
                    return data.map((v, i) => {
                      const x = (i / (data.length - 1)) * width
                      const spike = v > 1 ? (v / 3) * mid : v * 5
                      const y = mid - spike + (Math.sin(i * 0.5) * 3)
                      return `${x},${y}`
                    }).join(' ')
                  })()}
                />
                {/* 기준선 */}
                <line x1="0" y1="35" x2="560" y2="35" stroke="#e5e5e5" strokeWidth="1" strokeDasharray="4 2" />
              </svg>
            </div>
            <div className="inline-flex items-center gap-2 text-sm leading-5 text-stone-600">
              <div>최대 {maxVib.toFixed(2)} g · 임계 초과 {vibHistory.filter((v) => v > 1.5).length}회</div>
              <div className="text-stone-300">(최근 30초 기준)</div>
            </div>
          </div>

          {/* 음성 */}
          <div className="flex flex-1 flex-col gap-2 overflow-hidden rounded-[20px] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-2.5">
              <div className="text-base font-medium leading-6 text-stone-900">음성</div>
              <div className="text-sm leading-5 text-stone-300">노드 1</div>
            </div>
            <div className="flex flex-1 flex-col justify-center gap-3">
              <div className="text-3xl font-semibold leading-[48px] text-black">
                {sndText}
                <span className="align-middle text-sm font-normal leading-5">dB</span>
              </div>
              {/* 그라데이션 바 + 삼각형 마커 */}
              <div className="relative">
                {/* 삼각형 마커 */}
                <div
                  className="absolute -top-4 -translate-x-1/2 transition-all duration-300"
                  style={{ left: `${Math.min(100, Math.max(0, sndNum))}%` }}
                >
                  <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-stone-800" />
                </div>
                {/* 그라데이션 바 */}
                <div className="h-3 rounded-full overflow-hidden flex">
                  <div className="flex-[60] bg-lime-500" />
                  <div className="flex-[20] bg-yellow-400" />
                  <div className="flex-[20] bg-red-500" />
                </div>
              </div>
            </div>
            <div className="inline-flex items-center gap-2 text-sm leading-5 text-stone-600">
              <div>최고 {maxSnd.toFixed(0)} dB</div>
              <div className="text-stone-300">(최근 60초 기준)</div>
            </div>
          </div>

          {/* 자이로 */}
          <div className="flex flex-1 flex-col gap-2 overflow-hidden rounded-[20px] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-2.5">
              <div className="text-base font-medium leading-6 text-stone-900">자이로</div>
              <div className="text-sm leading-5 text-stone-300">노드 1</div>
            </div>
            <div className="flex flex-1 flex-col justify-center gap-4">
              <div className="text-3xl font-semibold leading-[48px] text-black">{gyrText}</div>
              {/* 3단계 슬라이더 바 + 삼각형 마커 */}
              <div className="relative">
                {/* 삼각형 마커 */}
                <div
                  className="absolute -top-4 -translate-x-1/2 transition-all duration-300"
                  style={{ left: `${Math.min(100, Math.max(0, (gyrVal / 45) * 100))}%` }}
                >
                  <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-stone-800" />
                </div>
                {/* 3단계 바 */}
                <div className="h-3 rounded-full overflow-hidden flex">
                  <div className="flex-1 bg-zinc-300" />
                  <div className="flex-1 bg-gradient-to-r from-yellow-400 to-orange-500" />
                  <div className="flex-1 bg-red-500" />
                </div>
                {/* 라벨 */}
                <div className="flex justify-between mt-2 text-xs font-semibold text-stone-800">
                  <span>정상</span>
                  <span>기울어짐</span>
                  <span>전도 위험</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 중앙: 노드 위험도 2개 */}
        <div className="absolute left-[627px] top-[143px] flex h-[679px] w-72 flex-col gap-2.5">
          {[{ title: '노드 1 위험도', score: node1Score, color: levelColorClass, label: levelChip }, { title: '노드 2 위험도', score: node2Score, color: 'bg-orange-500', label: '주의' }].map(
            (card) => (
              <div key={card.title} className="flex flex-1 items-center gap-6 overflow-hidden rounded-[20px] bg-white p-6 shadow-sm">
                <div className="flex flex-1 flex-col gap-5">
                  <div className="flex items-center gap-2.5 text-sm leading-5 text-stone-900">
                    <div className="flex-1 text-base font-medium leading-6">{card.title}</div>
                    <div className="flex h-5 items-center gap-1">
                      <div className={`h-3 w-3 rounded-full ${card.color}`} />
                      <div>{card.label}</div>
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col items-center gap-4">
                    <div className="relative h-60 w-60">
                      <div className="absolute inset-0 rounded-full bg-neutral-300" />
                      <div className={`absolute left-[19px] top-[18px] flex h-52 w-52 flex-col items-center justify-center gap-2.5 rounded-full ${card.color}`}>
                        <div className="flex items-baseline gap-1 text-6xl font-extrabold leading-[64px] text-white">
                          <span>{card.score}</span>
                          <span className="text-2xl leading-6">점</span>
                        </div>
                        <div className="text-2xl font-extrabold leading-6 text-white">/100</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          )}
        </div>

        {/* 우측: 종합 위험도 + 현장 알림 상태 */}
        <div className="absolute left-[922px] top-[143px] flex w-80 flex-col gap-6">
          <div className="flex h-[469px] items-center gap-6 overflow-hidden rounded-[20px] bg-white p-6 shadow-sm">
            <div className="flex flex-1 flex-col gap-5">
              <div className="text-base font-medium leading-6 text-stone-900">종합 위험도</div>
              <div className="flex flex-1 flex-col items-center justify-between">
                <div className="relative h-72 w-72">
                  <div className="absolute inset-0 rounded-full bg-neutral-300" />
                  <div className={`absolute left-[27px] top-[22px] flex h-60 w-60 flex-col items-center justify-center gap-3 rounded-full ${levelColorClass}`}>
                    <div className="flex items-center gap-1 pt-3.5 text-7xl font-extrabold leading-[78px] text-white">
                      <span>{riskScore}</span>
                      <span className="text-5xl">점</span>
                    </div>
                    <div className="text-3xl font-extrabold leading-7 text-white">/100</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-lg leading-4 text-zinc-500">
                  <span>현재 상태 :</span>
                  <div className="inline-flex items-center gap-2 rounded-lg bg-white px-2 py-1">
                    <div className={`h-5 w-5 ${levelColorClass}`} />
                    <div className={`text-base font-extrabold leading-4 ${levelTextClass}`}>{levelChip}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex h-48 items-start gap-6 overflow-hidden rounded-[20px] bg-white p-6 shadow-sm">
            <div className="flex flex-1 flex-col gap-2">
              <div className="text-base font-medium leading-6 text-stone-900">현장 알림 상태</div>
              <div className="flex flex-1 flex-col justify-between gap-1.5 text-sm leading-5 text-stone-600">
                <div className="flex items-center justify-between">
                  <span>구조대원 비콘 알림</span>
                  <span>[전송 완료]</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>경고 사운드</span>
                  <span>[활성화됨]</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>마지막 알림 시각</span>
                  <span>{lastPollTime}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs leading-4 text-stone-300">
                <div className="h-3 w-3 rounded-sm bg-stone-300" />
                <div>현재 표시된 상태는 서버 기준 최신 정보입니다.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

export default App
