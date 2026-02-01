#include <WiFiS3.h>
#include <LiquidCrystal_I2C.h>

////////////////////////////
// ⭐ WiFi 설정
////////////////////////////
const char* ssid = "YOUR_WIFI_NAME";
const char* password = "YOUR_PASSWORD";

WiFiServer server(8080);

////////////////////////////
// 핀 설정
////////////////////////////
#define BUZZER 8   // D8 연결

////////////////////////////
// LCD 설정
////////////////////////////
LiquidCrystal_I2C lcd(0x27, 16, 2);
// 안 되면 0x3F로 변경

////////////////////////////
// 데이터 변수
////////////////////////////
int temp = 0;
int gas = 0;
int alertFlag = 0;

////////////////////////////
void setup() {

  Serial.begin(115200);

  pinMode(BUZZER, OUTPUT);

  lcd.init();
  lcd.backlight();

  lcd.setCursor(0,0);
  lcd.print("Booting...");

  ////////////////////////////
  // WiFi 연결
  ////////////////////////////
  WiFi.begin(ssid, password);

  lcd.clear();
  lcd.print("Connecting WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    lcd.print(".");
  }

  lcd.clear();
  lcd.print("Connected!");
  delay(1000);

  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  server.begin();
}

////////////////////////////
void loop() {

  WiFiClient client = server.available();

  if (client) {

    String msg = client.readStringUntil('\n');
    Serial.println(msg);

    parseData(msg);

    updateLCD();
    controlBuzzer();

    client.stop();
  }
}

////////////////////////////
// 데이터 파싱
////////////////////////////
void parseData(String msg) {

  sscanf(msg.c_str(),
         "TEMP:%d,GAS:%d,ALERT:%d",
         &temp,&gas,&alertFlag);
}

////////////////////////////
// LCD 표시
////////////////////////////
void updateLCD() {

  lcd.clear();

  lcd.setCursor(0,0);
  lcd.print("T:");
  lcd.print(temp);
  lcd.print(" G:");
  lcd.print(gas);

  lcd.setCursor(0,1);

  if(alertFlag)
    lcd.print("!! DANGER !!");
  else
    lcd.print("SAFE");
}

////////////////////////////
// 부저 제어
////////////////////////////
void controlBuzzer() {

  // ⭐ Active 부저면 아래 줄 사용
  digitalWrite(BUZZER, alertFlag);

  // ⭐ Passive 부저면 이걸 사용
  /*
  if(alertFlag) tone(BUZZER, 2000);
  else noTone(BUZZER);
  */
}