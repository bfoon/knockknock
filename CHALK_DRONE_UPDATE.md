# Chalk update: drones — flight sensors, a quadcopter that flies, a ground station

Unzip over the repository root; every file sits at its real path.
Then run `python manage.py collectstatic` (no migrations, no new dependencies).

## Three new drawer tabs — `static/chalk/js/lab/lab_parts4.js` (new)

**Flight sensors**. Each one is ticked "On the drone" by default. If a quadcopter is on the bench, the sensor reads what the airframe is really doing. If there is no quadcopter, it follows its own sliders.
- IMU gyro + accelerometer (MPU-6050): X forward, Y left, Z up. It has a per-chip gyro bias (`calcOffsets()` removes it) and it picks up vibration from the motors.
- Barometer (BMP280): pressure falls with height (12 Pa per metre), plus about half a metre of noise.
- Compass (QMC5883L): Earth's field rotated by the real attitude, magnetic declination, and interference that grows with motor current.
- GPS (NEO-6M): sends real `$GPGGA` / `$GPRMC` sentences with checksums once a second at 9600 baud. It has a time to first fix, an indoors (no fix) setting and HDOP wander.
- Airspeed + pitot tube (MS4525DO): pressure = ½ρv², with a "tube blocked" fault.
- Laser rangefinder (VL53L0X): range up to about 2 m and 8190 when nothing is in range. Facing down it measures the true height above the ground.

**Drone**
- LiPo battery (2S–6S): voltage curve, sag under load, mAh counted, C rating, and low-voltage and short-circuit warnings.
- Power module: shunt + divider (V ÷ 11, 55 mV/A) and a 5.3 V BEC for the controller.
- ESC + brushless motor: reads servo pulses (1000–2000 µs) and arms only after it has seen 1000 µs, like BLHeli. It warns about a propeller on the bench.
- RC receiver (6-channel PWM): read with `pulseIn()`. Ticking "link lost" stops the pulses, so the sketch can test its failsafe.
- Quadcopter (X frame, 4 ESCs + motors, Betaflight motor order): a rigid body integrated every simulated millisecond. It has thrust ∝ speed², motor lag, roll/pitch/yaw torques, drag, wind, gusts, a few per cent of motor-to-motor spread, ground contact and crash detection. Without a stabiliser it tips over in seconds.

**Ground station**
- Display (PFD / FPV OSD): artificial horizon, pitch ladder, roll scale, speed and altitude tapes, heading, vertical speed, battery, RSSI, satellites, an ADS-B radar inset, and alerts (low battery, link lost, traffic, above 120 m). It takes data either straight from the drone or as `TLM roll=… alt=…` lines on RX through an HC-12 radio pair.
- ADS-B traffic receiver (1090 MHz): manned aircraft that pass by, reported as `TRF …` lines on TX.

## Arduino libraries — `static/chalk/js/lab/lab_drone.js` (new)
They use the same names and calls as the real libraries, so the sketches also run on a real Uno:
`Wire` (`begin`, `setClock`), `MPU6050_light`, `Adafruit_BMP280`, `QMC5883LCompass`, `TinyGPS++` (`gps.location.lat()` and the rest, parsed from the real NMEA characters with checksums), Pololu `VL53L0X`, and `MS4525DO` (the lab's own small airspeed library).
I²C sensors sit on A4/A5. Bus time is counted (100 kHz unless you call `setClock`). `begin()` waits for a chip that is still powering up. A single laser ranging takes 33 ms.

The same file adds wiring-coach tips for every new part and **12 ready-made projects** (level "Drones"): tilt meter, altimeter, compass, GPS + home distance, laser obstacle / landing, airspeed + stall warning, ESC arming, battery monitor, RC receiver + failsafe, a **complete quadcopter flight controller** (PID angle mode, mixer, barometric altitude hold, auto take-off → hover at 3 m → land), a telemetry downlink to the ground station with ADS-B traffic, and a return-to-home navigator.

## 3-D bodies (`lab_body.js`, `lab_body_view.js`)
- New bodies **Quadcopter drone** and **Fixed-wing drone**, both printable. The quadcopter has arms, motor pods, props, skids and a GPS mast.
- New test-drive mode "flies": with a quadcopter on the bench, the 3-D model flies the real physics. It banks, pitches, climbs and lands.

## Small changes to existing files
- `lab_mcu.js`: library hooks (`L.MCU_LIBS`, `MCU_CLASSES/METHODS/CONSTS`), nested calls (`gps.location.lat()`), `Wire`, servo pulses kept to the microsecond (`servoUs`), RC channels in `pulseIn()`, and "slow" library methods that really wait.
- `lab_runner.js`: `host.pulse()` and `host.i2c()`.
- `lab_panels.js`: a number field in the inspector (GPS latitude/longitude).
- `lab_pcb.js`: the frame and the ground station stay off the circuit board; the LiPo and ESCs are off-board.
- `lab_app.js`: the three new drawer tabs. `lab_studio.js`: the "fly" drive.
- `templates/chalk/lab.html`: loads `lab_parts4.js` and `lab_drone.js`, and bumps the cache versions.
- `chalk/lab_ai.py`: all 13 parts in the AI's catalogue, `DRONE_RULES` (wiring, libraries, mixer, telemetry format), and the new bodies and drive. `chalk/lab.py`: saves the new bodies and drive.

## Tests
`node tools/chalk_lab/run_all.js` runs all 16 suites, including the new `drone_test.js` (56 checks). It checks every sensor through its library, NMEA checksums, ESC arming, failsafe, the mixer signs, the unstabilised flip, the flight controller hovering and landing, telemetry crossing the radio, ADS-B alerts, bodies and the PCB.
