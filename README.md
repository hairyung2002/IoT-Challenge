1. 노드 구현
    - 자이로 센서
    - 진동 센서
    - 마이크
    - 데이터 수집 후 가공 없이 서버로 전달
2. 서버
    - 데이터 가공 → 센서 데이터 기반 위험도 예측(완료)
    - 예측 결과 웹사이트로 대시보드 시각화
3. 구조대원 노드 ( 비콘 이용 )
    - 디스플레이 위험도 시각화
    - 위험도에 따라 사이렌 같은 신호 전달

노드 → mobius → 서버(node.js) → API 연결 → 구조팀장 대시보드(React)

                                                          → mobius → 노드 → (비콘) → 구조대원

## 개발환경세팅

- ubuntu
- nodejs → 25.5.0
    - ubuntu cmd에서 아래 명령어 순서대로 입력
    - sudo apt update
    - sudo apt install -y curl
    - curl -fsSL [https://deb.nodesource.com/setup_25.x](https://deb.nodesource.com/setup_20.x) | sudo -E bash -
    - sudo apt install -y nodejs
- npm → 11.8.0
- pnpm → 10.28.2
    - corepack enable
    - corepack prepare pnpm@latest --activate
- ngrok → 3.35.0
    - curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
    - echo "deb [https://ngrok-agent.s3.amazonaws.com](https://ngrok-agent.s3.amazonaws.com/) buster main" | tee /etc/apt/sources.list.d/ngrok.list
    - apt update && apt install ngrok

## 개발 진행 상황 공유

- nodejs 위험도 판단 서버 로직 구현 완료
- arduino 센서 → mobius → nodejs 서버 파이프라인 구축 완료

## 남은 구현

- 센서 노드, 구조대원 노드 하드웨어 구현
- nodejs / React 대시보드 페이지 구현
- nodejs / 비콘 구조대원 전달 파이프라인 구축
- 발표자료, 영상 촬영

##