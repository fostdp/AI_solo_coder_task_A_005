const EventEmitter = require('events');
const db = require('../db');
const config = require('../../config');

class RuleEngine extends EventEmitter {
  constructor(commandDispatcher) {
    super();
    this.commandDispatcher = commandDispatcher;
    this.thresholds = config.thresholds;
    
    this.greenhouseStates = {};
    this.alarmStates = {};
    this.deviceStates = {};
  }

  initGreenhouse(greenhouseId) {
    if (!this.greenhouseStates[greenhouseId]) {
      this.greenhouseStates[greenhouseId] = {
        temperatureHistory: [],
        humidityHistory: [],
        co2History: []
      };
      this.alarmStates[greenhouseId] = {
        highTemp: false,
        lowHumidity: false,
        highCO2: false
      };
      this.deviceStates[greenhouseId] = {
        fan: false,
        spray: false,
        light: false
      };
    }
  }

  async processSensorData(greenhouseId, sensorData) {
    this.initGreenhouse(greenhouseId);
    
    this.commandDispatcher.updateLastSeen(greenhouseId);
    this.commandDispatcher.updateDeviceOnlineStatus(greenhouseId, true);

    await this.checkAlarms(greenhouseId, sensorData);
    await this.autoControl(greenhouseId, sensorData);

    return {
      alarms: this.alarmStates[greenhouseId],
      devices: this.deviceStates[greenhouseId]
    };
  }

  async checkAlarms(greenhouseId, sensorData) {
    const state = this.greenhouseStates[greenhouseId];
    const alarms = this.alarmStates[greenhouseId];
    const now = Date.now();

    state.temperatureHistory.push({ time: now, value: sensorData.temperature });
    state.humidityHistory.push({ time: now, value: sensorData.humidity });
    state.co2History.push({ time: now, value: sensorData.co2 });

    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const tenMinutesAgo = now - 10 * 60 * 1000;

    state.temperatureHistory = state.temperatureHistory.filter(d => d.time >= tenMinutesAgo);
    state.humidityHistory = state.humidityHistory.filter(d => d.time >= tenMinutesAgo);
    state.co2History = state.co2History.filter(d => d.time >= fiveMinutesAgo);

    const recentHighTemp = state.temperatureHistory.filter(
      d => d.time >= fiveMinutesAgo && d.value >= this.thresholds.temperature.alarmMax
    );
    if (recentHighTemp.length >= 10 && !alarms.highTemp) {
      alarms.highTemp = true;
      await db.writeAlarmData(
        greenhouseId,
        'high_temperature',
        `温度超过${this.thresholds.temperature.alarmMax}℃持续5分钟，当前温度: ${sensorData.temperature.toFixed(1)}℃`,
        'critical'
      );
      console.log(`⚠️  [RuleEngine] [${greenhouseId}] 高温告警触发`);
      this.emit('alarm', { greenhouseId, type: 'highTemp', level: 'critical' });
    }
    if (sensorData.temperature < this.thresholds.temperature.alarmMax - 2) {
      alarms.highTemp = false;
    }

    const recentLowHum = state.humidityHistory.filter(
      d => d.time >= tenMinutesAgo && d.value <= this.thresholds.humidity.alarmMin
    );
    if (recentLowHum.length >= 20 && !alarms.lowHumidity) {
      alarms.lowHumidity = true;
      await db.writeAlarmData(
        greenhouseId,
        'low_humidity',
        `湿度低于${this.thresholds.humidity.alarmMin}%持续10分钟，当前湿度: ${sensorData.humidity.toFixed(1)}%`,
        'warning'
      );
      console.log(`⚠️  [RuleEngine] [${greenhouseId}] 低湿告警触发`);
      this.emit('alarm', { greenhouseId, type: 'lowHumidity', level: 'warning' });
    }
    if (sensorData.humidity > this.thresholds.humidity.alarmMin + 5) {
      alarms.lowHumidity = false;
    }

    if (sensorData.co2 >= this.thresholds.co2.alarmMax && !alarms.highCO2) {
      alarms.highCO2 = true;
      await db.writeAlarmData(
        greenhouseId,
        'high_co2',
        `CO2浓度超过${this.thresholds.co2.alarmMax}ppm，当前浓度: ${sensorData.co2.toFixed(0)}ppm`,
        'warning'
      );
      console.log(`⚠️  [RuleEngine] [${greenhouseId}] CO2告警触发`);
      this.emit('alarm', { greenhouseId, type: 'highCO2', level: 'warning' });
    }
    if (sensorData.co2 < this.thresholds.co2.alarmMax - 200) {
      alarms.highCO2 = false;
    }
  }

  async autoControl(greenhouseId, sensorData) {
    const devices = this.deviceStates[greenhouseId];

    if (sensorData.temperature > this.thresholds.temperature.max && !devices.fan) {
      devices.fan = true;
      await this.commandDispatcher.dispatch(
        greenhouseId, 
        'fan', 
        'ON', 
        `温度过高: ${sensorData.temperature.toFixed(1)}℃`
      );
    } else if (sensorData.temperature < this.thresholds.temperature.min + 2 && devices.fan) {
      devices.fan = false;
      await this.commandDispatcher.dispatch(
        greenhouseId, 
        'fan', 
        'OFF', 
        `温度恢复正常: ${sensorData.temperature.toFixed(1)}℃`
      );
    }

    if (sensorData.humidity < this.thresholds.humidity.min && !devices.spray) {
      devices.spray = true;
      await this.commandDispatcher.dispatch(
        greenhouseId, 
        'spray', 
        'ON', 
        `湿度过低: ${sensorData.humidity.toFixed(1)}%`
      );
    } else if (sensorData.humidity > this.thresholds.humidity.min + 10 && devices.spray) {
      devices.spray = false;
      await this.commandDispatcher.dispatch(
        greenhouseId, 
        'spray', 
        'OFF', 
        `湿度恢复正常: ${sensorData.humidity.toFixed(1)}%`
      );
    }

    if (sensorData.light < this.thresholds.light.min && !devices.light) {
      devices.light = true;
      await this.commandDispatcher.dispatch(
        greenhouseId, 
        'light', 
        'ON', 
        `光照不足: ${sensorData.light.toFixed(0)}lux`
      );
    } else if (sensorData.light > this.thresholds.light.min + 3000 && devices.light) {
      devices.light = false;
      await this.commandDispatcher.dispatch(
        greenhouseId, 
        'light', 
        'OFF', 
        `光照恢复正常: ${sensorData.light.toFixed(0)}lux`
      );
    }
  }

  getDeviceStates(greenhouseId) {
    this.initGreenhouse(greenhouseId);
    return this.deviceStates[greenhouseId];
  }

  getAlarmStates(greenhouseId) {
    this.initGreenhouse(greenhouseId);
    return this.alarmStates[greenhouseId];
  }

  getAllDeviceStates() {
    return this.deviceStates;
  }

  setDeviceState(greenhouseId, device, state) {
    this.initGreenhouse(greenhouseId);
    this.deviceStates[greenhouseId][device] = state;
  }
}

module.exports = RuleEngine;
