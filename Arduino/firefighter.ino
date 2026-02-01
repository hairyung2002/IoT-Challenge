#include <WiFiS3.h>
#include <LiquidCrystal_I2C.h>

// WiFi 설정
const char* ssid = "Doyoun";
const char* password = "00000123";
const char* serverHost = "10.80.19.75"; // Node.js 서버 IP
const uint16_t serverPort = 3000;         // Node.js 서버 포트 (/status)

// 핀 설정
#define BUZZER 8   // D8 연결

// LCD 설정
LiquidCrystal_I2C lcd(0x27, 16, 2); // 주소가 다르면 0x3F 시도

// 상태 변수
bool danger = false;
bool warning = false;
int tempC = 0;
int score = 0;
bool wifiOk = false;
bool serverOk = false;

void connectWiFi() {
  WiFi.begin(ssid, password);
  lcd.clear();
  lcd.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    lcd.print(".");
  }
  lcd.clear();
  lcd.print("Connected!");
  delay(500);
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  wifiOk = true;
}

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER, OUTPUT);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Booting...");
  connectWiFi();
}

void parseStatus(const String& body) {
  danger = body.indexOf("\"level\":\"DANGER\"") >= 0;
  warning = (!danger) && body.indexOf("\"level\":\"WARNING\"") >= 0;

  int tPos = body.indexOf("\"temp\":");
  if (tPos >= 0) {
    tempC = body.substring(tPos + 7).toInt();
  }

  int sPos = body.indexOf("\"overallScore\":");
  if (sPos >= 0) {
    score = body.substring(sPos + 15).toInt();
  }
}

void fetchStatus() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    if (WiFi.status() != WL_CONNECTED) {
      wifiOk = false;
      serverOk = false;
      return;
    }
  }

  WiFiClient c;
  c.setTimeout(2000);
  if (!c.connect(serverHost, serverPort)) {
    Serial.println("server connect fail");
    serverOk = false;
    return;
  }

  c.print("GET /status HTTP/1.1\r\nHost: ");
  c.print(serverHost);
  c.print("\r\nConnection: close\r\n\r\n");

  // 헤더 스킵
  while (c.connected()) {
    String line = c.readStringUntil('\n');
    if (line == "\r" || line.length() == 0) break;
  }

  // 본문 전체 읽기 (타임아웃 2초)
  String body = c.readString();
  c.stop();

  if (body.length() > 0) {
    parseStatus(body);
    Serial.println(body);
    serverOk = true;
  } else {
    serverOk = false;
    danger = false;
    warning = false;
  }
}

void updateLCD() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("UP:OK ");
  lcd.print("WF:"); lcd.print(wifiOk ? "OK " : "NG ");
  lcd.print("SV:"); lcd.print(serverOk ? "OK" : "NG");

  lcd.setCursor(0, 1);
  if (!serverOk) {
    lcd.print("NO DATA ");
  } else if (danger) {
    lcd.print("DANGER  ");
  } else if (warning) {
    lcd.print("WARN    ");
  } else {
    lcd.print("SAFE    ");
  }

  lcd.print("T:");
  lcd.print(tempC);
  lcd.print(" S:");
  lcd.print(score);
}

void controlBuzzer() {
  if (!serverOk) {
    digitalWrite(BUZZER, LOW);
    noTone(BUZZER);
  } else if (danger) {
    digitalWrite(BUZZER, HIGH);
  } else if (warning) {
    tone(BUZZER, 2000, 200);
  } else {
    digitalWrite(BUZZER, LOW);
    noTone(BUZZER);
  }
}

void loop() {
  fetchStatus();
  updateLCD();
  controlBuzzer();
  delay(1500); // 1.5s 폴링
}