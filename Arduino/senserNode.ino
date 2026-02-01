// ----------------------------------------------------------------------------
// Sensor node: reads temperature (LM35), gyro (MPU6050), sound level (analog)
// Wiring (Arduino Uno / Nano style pins):
//   - LM35 temperature: VCC 5V, GND GND, OUT -> A1
//   - Analog sound (mic) module: VCC 5V, GND GND, OUT -> A0
//   - MPU6050 gyro/accel (I2C): VCC 3.3V (or 5V if breakout supports), GND GND,
//       SDA -> A4 (SDA), SCL -> A5 (SCL)
//   - If you use a different board, match SDA/SCL pins accordingly.
// ----------------------------------------------------------------------------

#include <Wire.h>
#include <WiFiS3.h>
#include <MPU6050_light.h>  // Library: "MPU6050_light" by rfetick (Library Manager)

// WiFi config ---------------------------------------------------------------
const char* ssid = "YOUR_WIFI_NAME";      // 사용할 Wi-Fi SSID
const char* password = "YOUR_PASSWORD";    // Wi-Fi 비밀번호
const char* host = "10.80.19.75";           // Node.js 서버 IP (Windows Wi-Fi IPv4)
const uint16_t hostPort = 3000;             // Node.js 서버 포트 (/monitor)

// Pin config ----------------------------------------------------------------
const uint8_t SOUND_PIN = A0; // Analog mic OUT
const uint8_t TEMP_PIN = A1;  // LM35 OUT

// Globals -------------------------------------------------------------------
WiFiClient client;
MPU6050 mpu(Wire);

float tempC = 0.0f;
float soundRaw = 0.0f;
float tiltDeg = 0.0f; // simple pitch angle approximation

void setup() {
	Serial.begin(115200);

	Wire.begin();
	byte status = mpu.begin();
	if (status != 0) {
		Serial.print(F("MPU6050 init failed, status: "));
		Serial.println(status);
	} else {
		Serial.println(F("MPU6050 ready"));
		mpu.calcOffsets();
	}

	WiFi.begin(ssid, password);
	Serial.print("WiFi connecting");
	while (WiFi.status() != WL_CONNECTED) {
		delay(500);
		Serial.print(".");
	}
	Serial.println(" connected");
	Serial.print("IP: ");
	Serial.println(WiFi.localIP());
}

float readTemperatureC() {
	int raw = analogRead(TEMP_PIN);
	// For LM35: 10 mV per °C. On 5V, ADC step ~4.88 mV.
	float millivolt = (raw * 5.0f * 1000.0f) / 1023.0f;
	return millivolt / 10.0f;
}

float readSoundLevel() {
	int raw = analogRead(SOUND_PIN);
	// Return normalized 0-1023 value; convert to % for UI if needed.
	return static_cast<float>(raw);
}

float readTiltDeg() {
	mpu.update();
	// Use pitch angle as a simple tilt indicator.
	return mpu.getAngleX();
}

String classifySound(float raw) {
	if (raw > 800) return "crash";
	if (raw > 600) return "crack";
	return String((int)raw); // fallback numeric
}

void sendToServer(float t, float tilt, float sndRaw) {
	if (WiFi.status() != WL_CONNECTED) return;
	if (!client.connect(host, hostPort)) {
		Serial.println(F("connect failed"));
		return;
	}

	String snd = classifySound(sndRaw);
	String payload = String("{\"nodeId\":\"node-1\",\"temp\":") + String(t, 1) +
									 ",\"gyr\":" + String(tilt, 1) +
									 ",\"snd\":\"" + snd + "\"}";

	client.print("POST /monitor HTTP/1.1\r\n");
	client.print("Host: "); client.print(host); client.print("\r\n");
	client.print("Content-Type: application/json\r\n");
	client.print("Content-Length: "); client.print(payload.length()); client.print("\r\n");
	client.print("Connection: close\r\n\r\n");
	client.print(payload);
	client.stop();
}

void loop() {
	if (WiFi.status() != WL_CONNECTED) {
		WiFi.begin(ssid, password);
		delay(500);
		return;
	}

	tempC = readTemperatureC();
	soundRaw = readSoundLevel();
	tiltDeg = readTiltDeg();

	Serial.print(F("TEMP:"));
	Serial.print(tempC, 1);
	Serial.print(F("C  GYR:"));
	Serial.print(tiltDeg, 1);
	Serial.print(F("deg  SND raw:"));
	Serial.println(soundRaw, 0);

	sendToServer(tempC, tiltDeg, soundRaw);

	delay(1000); // 1s interval
}
