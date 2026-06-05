const mqtt = require('mqtt');
const greenhouseConfig = require('../config');
require('dotenv').config();

const SIMULATOR_CONFIG = {
  intervalMs: parseInt(process.env.SIM_INTERVAL_MS, 10) || 30000,
  staggerDelayMs: parseInt(process.env.SIM_STAGGER_MS, 10) || 100,
  offlineSimulation: process.env.SIM_OFFLINE === 'true',
  offlineGreenhouses: (process.env.SIM_OFFLINE_GH || '').split(',').filter(Boolean)
};

const SENSOR_PROFILES = {
  '番茄': {
    temperature: { base: 25, amplitude: 5, drift: 0.4 },
    humidity:    { base: 65, amplitude: 10, drift: 0.5 },
    light:       { base: 12000, amplitude: 5000, drift: 0.3 },
    co2:         { base: 800, amplitude: 300, drift: 0.45 },
    soilMoisture:{ base: 55, amplitude: 10, drift: 0.55 }
  },
  '黄瓜': {
    temperature: { base: 26, amplitude: 4, drift: 0.35 },
    humidity:    { base: 70, amplitude: 12, drift: 0.5 },
    light:       { base: 14000, amplitude: 6000, drift: 0.3 },
    co2:         { base: 750, amplitude: 250, drift: 0.4 },
    soilMoisture:{ base: 60, amplitude: 12, drift: 0.55 }
  },
  '草莓': {
    temperature: { base: 22, amplitude: 3, drift: 0.3 },
    humidity:    { base: 60, amplitude: 8, drift: 0.45 },
    light:       { base: 10000, amplitude: 4000, drift: 0.25 },
    co2:         { base: 700, amplitude: 200, drift: 0.4 },
    soilMoisture:{ base: 50, amplitude: 8, drift: 0.5 }
  },
  'default': {
    temperature: { base: 24, amplitude: 6, drift: 0.4 },
    humidity:    { base: 60, amplitude: 15, drift: 0.5 },
    light:       { base: 11000, amplitude: 6000, drift: 0.3 },
    co2:         { base: 800, amplitude: 400, drift: 0.45 },
    soilMoisture:{ base: 55, amplitude: 12, drift: 0.55 }
  }
};

const CONTROL_EFFECTS = {
  fan: {
    ON:  { temperature: -2, humidity: -3 },
    OFF: { temperature: 0, humidity: 0 }
  },
  spray: {
    ON:  { humidity: 10, soilMoisture: 3 },
    OFF: { humidity: 0, soilMoisture: 0 }
  },
  light: {
    ON:  { light: 5000 },
    OFF: { light: 0 }
  }
};

const SENSOR_LIMITS = {
  temperature:  { min: 5, max: 50 },
  humidity:     { min: 10, max: 99 },
  light:        { min: 0, max: 30000 },
  co2:          { min: 200, max: 3000 },
  soilMoisture: { min: 5, max: 95 }
};

class GreenhouseSimulator {
  constructor(greenhouse, profile) {
    this.greenhouse = greenhouse;
    this.profile = profile;
    this.activeDevices = { fan: false, spray: false, light: false };
    
    this.data = {};
    for (const [sensor, cfg] of Object.entries(profile)) {
      this.data[sensor] = cfg.base + (Math.random() - 0.5) * cfg.amplitude;
    }
  }

  tick(now) {
    const hour = new Date(now).getHours();
    const dayFactor = (hour >= 6 && hour <= 18) ? 1.0 : 0.2;
    const seasonalFactor = 1 + 0.1 * Math.sin((hour - 6) / 24 * Math.PI * 2);

    for (const [sensor, cfg] of Object.entries(this.profile)) {
      let drift;
      
      switch (sensor) {
        case 'temperature':
          drift = (Math.random() - cfg.drift) * 1.5 * seasonalFactor;
          if (this.activeDevices.fan) drift -= 0.5;
          break;
        case 'humidity':
          drift = (Math.random() - 0.5) * 3;
          if (this.activeDevices.spray) drift += 1.0;
          break;
        case 'light':
          drift = (Math.random() - 0.5) * 1000 * dayFactor;
          if (this.activeDevices.light) drift += 500;
          break;
        case 'co2':
          drift = (Math.random() - cfg.drift) * 50;
          if (this.activeDevices.fan) drift -= 20;
          break;
        case 'soilMoisture':
          drift = (Math.random() - cfg.drift) * 1;
          if (this.activeDevices.spray) drift += 0.3;
          break;
        default:
          drift = (Math.random() - 0.5) * 2;
      }

      this.data[sensor] += drift;
      const limits = SENSOR_LIMITS[sensor];
      this.data[sensor] = Math.max(limits.min, Math.min(limits.max, this.data[sensor]));
    }
  }

  applyControl(device, action) {
    const effects = CONTROL_EFFECTS[device]?.[action];
    if (!effects) return;

    this.activeDevices[device] = (action === 'ON');

    for (const [sensor, delta] of Object.entries(effects)) {
      if (this.data[sensor] !== undefined) {
        this.data[sensor] += delta;
        const limits = SENSOR_LIMITS[sensor];
        this.data[sensor] = Math.max(limits.min, Math.min(limits.max, this.data[sensor]));
      }
    }
  }

  getSnapshot() {
    const result = {};
    for (const [sensor, value] of Object.entries(this.data)) {
      if (sensor === 'light' || sensor === 'co2') {
        result[sensor] = parseFloat(value.toFixed(0));
      } else {
        result[sensor] = parseFloat(value.toFixed(2));
      }
    }
    result.timestamp = new Date().toISOString();
    return result;
  }
}

function getProfile(crop) {
  return SENSOR_PROFILES[crop] || SENSOR_PROFILES['default'];
}

const mqttOptions = {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  clientId: 'sensor-simulator-' + Math.random().toString(16).substr(2, 8),
  reconnectPeriod: 5000
};

const client = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883', mqttOptions);

const simulators = new Map();

greenhouseConfig.greenhouses.forEach(gh => {
  const profile = getProfile(gh.crop);
  const sim = new GreenhouseSimulator(gh, profile);
  simulators.set(gh.id, sim);
});

client.on('connect', () => {
  console.log('✅ 模拟器 MQTT 连接成功');
  console.log(`📊 模拟 ${simulators.size} 个大棚传感器数据`);
  console.log(`⏱️  每 ${SIMULATOR_CONFIG.intervalMs / 1000} 秒发送一次数据`);
  console.log(`📋 作物传感器配置: ${Object.keys(SENSOR_PROFILES).join(', ')}`);
  console.log('');

  if (SIMULATOR_CONFIG.offlineSimulation) {
    console.log(`🔴 离线模拟已启用，以下大棚将模拟离线: ${SIMULATOR_CONFIG.offlineGreenhouses.join(', ') || '无'}`);
  }

  setInterval(() => sendAllSensorData(), SIMULATOR_CONFIG.intervalMs);
  sendAllSensorData();
});

client.on('reconnect', () => {
  console.log('🔄 模拟器 MQTT 正在重连...');
});

client.on('error', (err) => {
  console.error('❌ 模拟器 MQTT 错误:', err.message);
});

client.on('message', (topic, message) => {
  if (topic.includes('/control/')) {
    const parts = topic.split('/');
    const greenhouseId = parts[1];
    const device = parts[3];

    try {
      const data = JSON.parse(message.toString());
      const sim = simulators.get(greenhouseId);
      
      if (!sim) {
        console.warn(`⚠️  [${greenhouseId}] 未知大棚，忽略控制指令`);
        return;
      }

      console.log(`🔧 [${greenhouseId}] 收到控制指令: ${device} ${data.action} - ${data.reason}`);
      
      sim.applyControl(device, data.action);

      const responseTopic = `greenhouse/${greenhouseId}/control/response`;
      client.publish(responseTopic, JSON.stringify({
        device,
        action: data.action,
        status: 'executed',
        timestamp: new Date().toISOString(),
        requestId: data.requestId || null
      }));

      console.log(`✅ [${greenhouseId}] ${device} ${data.action} 已执行并响应`);
    } catch (error) {
      console.error(`❌ [${greenhouseId}] 处理控制指令错误:`, error.message);
    }
  }
});

function sendAllSensorData() {
  const now = Date.now();
  let index = 0;

  simulators.forEach((sim, greenhouseId) => {
    if (SIMULATOR_CONFIG.offlineSimulation && SIMULATOR_CONFIG.offlineGreenhouses.includes(greenhouseId)) {
      return;
    }

    setTimeout(() => {
      sim.tick(now);
      const snapshot = sim.getSnapshot();
      const topic = `greenhouse/${greenhouseId}/sensor/data`;

      client.publish(topic, JSON.stringify(snapshot));

      const gh = sim.greenhouse;
      console.log(
        `📡 [${greenhouseId}] ${gh.name} - ` +
        `温度:${snapshot.temperature}℃ ` +
        `湿度:${snapshot.humidity}% ` +
        `光照:${snapshot.light}lux ` +
        `CO2:${snapshot.co2}ppm ` +
        `土壤:${snapshot.soilMoisture}%`
      );
    }, index * SIMULATOR_CONFIG.staggerDelayMs);
    index++;
  });
}

client.subscribe('greenhouse/+/control/+');

console.log('🚀 智慧农业大棚传感器模拟器启动中...');
console.log('📡 连接到 MQTT 代理:', process.env.MQTT_BROKER_URL);
console.log('⚙️  配置:', JSON.stringify(SIMULATOR_CONFIG, null, 2));
