// Chalk Link from an ESP32 (or ESP8266: swap the two WiFi/HTTP includes).
//
// A Chalk Link is a table of named values ("tags") behind a web address.
// This sketch does the two things a real project needs:
//   - reads the tag "lamp" and drives a real LED from it
//   - publishes the tag "doorbell" when a real button is pressed
// Anything else that holds the address — the Circuit Lab's simulation, a
// phone app, your own website — sees the same tags.
//
// It uses only GET requests, which every Wi-Fi board can make:
//   …/tags/lamp/?raw=1          answers 1 or 0
//   …/set/?doorbell=1&by=esp32  writes a value

#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_NAME = "your-wifi";
const char* WIFI_PASS = "your-password";
const String LINK = "https://your.site/chalk/api/link/ck_PASTE_YOUR_KEY_HERE/";

const int LED = 2;        // most ESP32 boards have an LED on GPIO2
const int BUTTON = 0;     // and a BOOT button on GPIO0 (reads LOW when pressed)

String fetch(const String& path) {
  HTTPClient http;
  http.begin(LINK + path);
  String body = http.GET() == 200 ? http.getString() : "";
  http.end();
  return body;
}

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);
  WiFi.begin(WIFI_NAME, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
  Serial.println(" connected");
}

bool wasPressed = false;

void loop() {
  // 1. obey: the tag "lamp" decides the LED
  digitalWrite(LED, fetch("tags/lamp/?raw=1") == "1" ? HIGH : LOW);

  // 2. report: tell the link when the button goes down or up
  bool pressed = digitalRead(BUTTON) == LOW;
  if (pressed != wasPressed) {
    wasPressed = pressed;
    fetch(String("set/?doorbell=") + (pressed ? "1" : "0") + "&by=esp32");
  }
  delay(400);             // a couple of requests a second is plenty
}
