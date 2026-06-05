const db = require('./db');
const config = require('../config/greenhouses.json');

const greenhouseStates = {};
const alarmStates = {};
const deviceStates = {};
const deviceOnlineStatus = {};
const commandRetryQueue = {};
const lastSensorTime = {};

const MAX_RETRY_COUNT = 3;
const RETRY_INTERVAL = 5000;
const OFFLINE_THRESHOLD = 120000;

const growthStageWeights = {
  seedling: {
    temperature: 0.45,
    humidity: 0.35,
    light: 0.20
  },
  vegetative: {
    temperature: 0.40,
    humidity: 0.30,
    light: 0.30
  },
  flowering: {
    temperature: 0.35,
    humidity: 0.35,
    light: 0.30
  },
  fruiting: {
    temperature: 0.35,
    humidity: 0.40,
    light: 0.25
  },
  maturity: {
    temperature: 0.30,
    humidity: 0.45,
    light: 0.25
  }
};

function initGreenhouse(greenhouseId) {
  if (!greenhouseStates[greenhouseId]) {
    greenhouseStates[greenhouseId] = {
      temperatureHistory: [],
      humidityHistory: [],
      co2History: []
    };
    alarmStates[greenhouseId] = {
      highTemp: false,
      lowHumidity: false,
      highCO2: false
    };
    deviceStates[greenhouseId] = {
      fan: false,
      spray: false,
      light: false
    };
    deviceOnlineStatus[greenhouseId] = {
      online: true,
      lastSeen: Date.now()
    };
    commandRetryQueue[greenhouseId] = {};
    lastSensorTime[greenhouseId] = Date.now();
  }
}

function getGreenhouseInfo(greenhouseId) {
  const gh = config.greenhouses.find(g => g.id === greenhouseId);
  return gh || { crop: 'default', growthStage: 'vegetative' };
}

function getWeights(greenhouseId) {
  const ghInfo = getGreenhouseInfo(greenhouseId);
  const growthStage = ghInfo.growthStage || 'vegetative';
  return growthStageWeights[growthStage] || config.weights;
}

function calculateScore(data, greenhouseId) {
  const { thresholds } = config;
  const weights = getWeights(greenhouseId);
  
  const ideal = {
    temperature: (thresholds.temperature.min + thresholds.temperature.max) / 2,
    humidity: (thresholds.humidity.min + thresholds.humidity.max) / 2,
    light: (thresholds.light.min + thresholds.light.max) / 2
  };
  
  const tempRange = thresholds.temperature.max - thresholds.temperature.min;
  const humRange = thresholds.humidity.max - thresholds.humidity.min;
  const lightRange = thresholds.light.max - thresholds.light.min;
  
  const tempDeviation = Math.abs(data.temperature - ideal.temperature) / tempRange;
  const humDeviation = Math.abs(data.humidity - ideal.humidity) / humRange;
  const lightDeviation = Math.abs(data.light - ideal.light) / lightRange;
  
  const score = 100 - (
    tempDeviation * weights.temperature * 100 +
    humDeviation * weights.humidity * 100 +
    lightDeviation * weights.light * 100
  );
  
  return Math.max(0, Math.min(100, score));
}

function getScoreColor(score) {
  if (score > 80) return '#4CAF50';
  if (score >= 60) return '#FFC107';
  return '#F44336';
}

function isDeviceOnline(greenhouseId) {
  initGreenhouse(greenhouseId);
  const status = deviceOnlineStatus[greenhouseId];
  const now = Date.now();
  return status.online && (now - status.lastSeen < OFFLINE_THRESHOLD);
}

function updateDeviceOnlineStatus(greenhouseId, online) {
  initGreenhouse(greenhouseId);
  deviceOnlineStatus[greenhouseId] = {
    online,
    lastSeen: Date.now()
  };
  console.log(`📡 [${greenhouseId}] 设备${online ? '上线' : '离线'}`);
}

async function retryCommand(greenhouseId, device, action, reason, mqttClient, retryCount = 0) {
  const queueKey = `${device}-${action}`;
  
  if (!commandRetryQueue[greenhouseId][queueKey]) {
    commandRetryQueue[greenhouseId][queueKey] = {
      retryCount,
      timer: null
    };
  }
  
  const queueItem = commandRetryQueue[greenhouseId][queueKey];
  
  if (queueItem.retryCount >= MAX_RETRY_COUNT) {
    console.error(`❌ [${greenhouseId}] ${device} ${action} 重试${MAX_RETRY_COUNT}次失败，放弃`);
    delete commandRetryQueue[greenhouseId][queueKey];
    return false;
  }
  
  if (!isDeviceOnline(greenhouseId)) {
    console.log(`⏳ [${greenhouseId}] 设备离线，等待重试 ${device} ${action} (${queueItem.retryCount + 1}/${MAX_RETRY_COUNT})`);
    queueItem.timer = setTimeout(async () => {
      queueItem.retryCount++;
      await retryCommand(greenhouseId, device, action, reason, mqttClient, queueItem.retryCount);
    }, RETRY_INTERVAL);
    return false;
  }
  
  if (queueItem.timer) {
    clearTimeout(queueItem.timer);
  }
  
  console.log(`🔄 [${greenhouseId}] 重试发送 ${device} ${action} (${queueItem.retryCount + 1}/${MAX_RETRY_COUNT})`);
  const result = await sendControlCommandInternal(mqttClient, greenhouseId, device, action, reason);
  
  if (!result) {
    queueItem.timer = setTimeout(async () => {
      queueItem.retryCount++;
      await retryCommand(greenhouseId, device, action, reason, mqttClient, queueItem.retryCount);
    }, RETRY_INTERVAL);
  } else {
    delete commandRetryQueue[greenhouseId][queueKey];
  }
  
  return result;
}

async function sendControlCommandInternal(mqttClient, greenhouseId, device, action, reason) {
  const topic = `greenhouse/${greenhouseId}/control/${device}`;
  const message = JSON.stringify({ 
    action, 
    reason, 
    timestamp: new Date().toISOString(),
    requestId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  });
  
  if (!mqttClient || !mqttClient.connected) {
    console.error(`❌ [${greenhouseId}] MQTT未连接，无法发送 ${device} ${action}`);
    return false;
  }
  
  try {
    mqttClient.publish(topic, message, { qos: 1 }, (err) => {
      if (err) {
        console.error(`❌ [${greenhouseId}] MQTT发布失败:`, err.message);
      }
    });
    await db.writeControlData(greenhouseId, device, action, reason);
    console.log(`🔧 [${greenhouseId}] ${device} ${action} - ${reason}`);
    return true;
  } catch (error) {
    console.error(`❌ [${greenhouseId}] 发送控制指令失败:`, error.message);
    return false;
  }
}

async function sendControlCommand(mqttClient, greenhouseId, device, action, reason) {
  initGreenhouse(greenhouseId);
  
  if (!isDeviceOnline(greenhouseId)) {
    console.log(`⚠️  [${greenhouseId}] 设备离线，加入重试队列: ${device} ${action}`);
    await retryCommand(greenhouseId, device, action, reason, mqttClient, 0);
    return false;
  }
  
  return await sendControlCommandInternal(mqttClient, greenhouseId, device, action, reason);
}

async function syncAllDeviceStates(mqttClient) {
  console.log('🔄 同步所有设备状态...');
  for (const gh of config.greenhouses) {
    initGreenhouse(gh.id);
    const devices = deviceStates[gh.id];
    
    for (const [device, state] of Object.entries(devices)) {
      if (state) {
        await sendControlCommand(mqttClient, gh.id, device, 'ON', '重连同步状态');
      }
    }
  }
  console.log('✅ 设备状态同步完成');
}

async function checkAlarms(greenhouseId, data, mqttClient) {
  initGreenhouse(greenhouseId);
  const state = greenhouseStates[greenhouseId];
  const alarms = alarmStates[greenhouseId];
  const now = Date.now();
  
  lastSensorTime[greenhouseId] = now;
  updateDeviceOnlineStatus(greenhouseId, true);
  
  state.temperatureHistory.push({ time: now, value: data.temperature });
  state.humidityHistory.push({ time: now, value: data.humidity });
  state.co2History.push({ time: now, value: data.co2 });
  
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  const tenMinutesAgo = now - 10 * 60 * 1000;
  
  state.temperatureHistory = state.temperatureHistory.filter(d => d.time >= tenMinutesAgo);
  state.humidityHistory = state.humidityHistory.filter(d => d.time >= tenMinutesAgo);
  state.co2History = state.co2History.filter(d => d.time >= fiveMinutesAgo);
  
  const recentHighTemp = state.temperatureHistory.filter(
    d => d.time >= fiveMinutesAgo && d.value >= config.thresholds.temperature.alarmMax
  );
  if (recentHighTemp.length >= 10 && !alarms.highTemp) {
    alarms.highTemp = true;
    await db.writeAlarmData(
      greenhouseId,
      'high_temperature',
      `温度超过${config.thresholds.temperature.alarmMax}℃持续5分钟，当前温度: ${data.temperature.toFixed(1)}℃`,
      'critical'
    );
    console.log(`⚠️  [${greenhouseId}] 高温告警触发`);
  }
  if (data.temperature < config.thresholds.temperature.alarmMax - 2) {
    alarms.highTemp = false;
  }
  
  const recentLowHum = state.humidityHistory.filter(
    d => d.time >= tenMinutesAgo && d.value <= config.thresholds.humidity.alarmMin
  );
  if (recentLowHum.length >= 20 && !alarms.lowHumidity) {
    alarms.lowHumidity = true;
    await db.writeAlarmData(
      greenhouseId,
      'low_humidity',
      `湿度低于${config.thresholds.humidity.alarmMin}%持续10分钟，当前湿度: ${data.humidity.toFixed(1)}%`,
      'warning'
    );
    console.log(`⚠️  [${greenhouseId}] 低湿告警触发`);
  }
  if (data.humidity > config.thresholds.humidity.alarmMin + 5) {
    alarms.lowHumidity = false;
  }
  
  if (data.co2 >= config.thresholds.co2.alarmMax && !alarms.highCO2) {
    alarms.highCO2 = true;
    await db.writeAlarmData(
      greenhouseId,
      'high_co2',
      `CO2浓度超过${config.thresholds.co2.alarmMax}ppm，当前浓度: ${data.co2.toFixed(0)}ppm`,
      'warning'
    );
    console.log(`⚠️  [${greenhouseId}] CO2告警触发`);
  }
  if (data.co2 < config.thresholds.co2.alarmMax - 200) {
    alarms.highCO2 = false;
  }
}

async function autoControl(greenhouseId, data, mqttClient) {
  initGreenhouse(greenhouseId);
  const devices = deviceStates[greenhouseId];
  const { thresholds } = config;
  
  if (data.temperature > thresholds.temperature.max && !devices.fan) {
    devices.fan = true;
    await sendControlCommand(mqttClient, greenhouseId, 'fan', 'ON', `温度过高: ${data.temperature.toFixed(1)}℃`);
  } else if (data.temperature < thresholds.temperature.min + 2 && devices.fan) {
    devices.fan = false;
    await sendControlCommand(mqttClient, greenhouseId, 'fan', 'OFF', `温度恢复正常: ${data.temperature.toFixed(1)}℃`);
  }
  
  if (data.humidity < thresholds.humidity.min && !devices.spray) {
    devices.spray = true;
    await sendControlCommand(mqttClient, greenhouseId, 'spray', 'ON', `湿度过低: ${data.humidity.toFixed(1)}%`);
  } else if (data.humidity > thresholds.humidity.min + 10 && devices.spray) {
    devices.spray = false;
    await sendControlCommand(mqttClient, greenhouseId, 'spray', 'OFF', `湿度恢复正常: ${data.humidity.toFixed(1)}%`);
  }
  
  if (data.light < thresholds.light.min && !devices.light) {
    devices.light = true;
    await sendControlCommand(mqttClient, greenhouseId, 'light', 'ON', `光照不足: ${data.light.toFixed(0)}lux`);
  } else if (data.light > thresholds.light.min + 3000 && devices.light) {
    devices.light = false;
    await sendControlCommand(mqttClient, greenhouseId, 'light', 'OFF', `光照恢复正常: ${data.light.toFixed(0)}lux`);
  }
}

function getDeviceStates(greenhouseId) {
  initGreenhouse(greenhouseId);
  return deviceStates[greenhouseId];
}

function getAlarmStates(greenhouseId) {
  initGreenhouse(greenhouseId);
  return alarmStates[greenhouseId];
}

function getOnlineStatus(greenhouseId) {
  initGreenhouse(greenhouseId);
  return {
    online: isDeviceOnline(greenhouseId),
    lastSeen: deviceOnlineStatus[greenhouseId]?.lastSeen || 0
  };
}

function getAllGrowthStages() {
  return Object.keys(growthStageWeights);
}

function getGrowthStageWeightsInfo() {
  return growthStageWeights;
}

module.exports = {
  calculateScore,
  getScoreColor,
  checkAlarms,
  autoControl,
  getDeviceStates,
  getAlarmStates,
  getOnlineStatus,
  syncAllDeviceStates,
  updateDeviceOnlineStatus,
  isDeviceOnline,
  getAllGrowthStages,
  getGrowthStageWeightsInfo,
  getWeights
};
