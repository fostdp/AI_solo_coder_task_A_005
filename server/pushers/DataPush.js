const WebSocket = require('ws');
const EventEmitter = require('events');
const db = require('../db');
const greenhouseConfig = require('../../config');

class DataPush extends EventEmitter {
  constructor(port, evaluator, ruleEngine, commandDispatcher) {
    super();
    this.port = port;
    this.evaluator = evaluator;
    this.ruleEngine = ruleEngine;
    this.commandDispatcher = commandDispatcher;
    
    this.wss = null;
    this.clients = new Set();
  }

  start() {
    this.wss = new WebSocket.Server({ port: this.port });
    
    this.wss.on('connection', (ws) => {
      console.log('👤 [DataPush] 新的 WebSocket 连接');
      this.clients.add(ws);
      
      this.sendInitialData(ws);
      
      ws.on('close', () => {
        console.log('👤 [DataPush] WebSocket 连接关闭');
        this.clients.delete(ws);
      });
      
      ws.on('error', (error) => {
        console.error('[DataPush] WebSocket 错误:', error.message);
      });
    });
    
    console.log(`🔌 [DataPush] WebSocket 服务器运行在 ws://localhost:${this.port}`);
  }

  broadcast(data) {
    const message = JSON.stringify(data);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message, (err) => {
          if (err) {
            console.error('[DataPush] 发送消息失败:', err.message);
          }
        });
      }
    });
  }

  sendTo(client, data) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  }

  async sendInitialData(ws) {
    try {
      const allData = await db.getAllLatestData();
      const greenhouseStatus = {};
      
      for (const gh of greenhouseConfig.greenhouses) {
        const ghData = allData.find(d => d.greenhouseId === gh.id);
        const onlineStatus = this.commandDispatcher.getOnlineStatus(gh.id);
        const weights = this.evaluator.getWeights(gh.id);
        
        if (ghData) {
          const evaluation = this.evaluator.evaluate(ghData, gh.id);
          greenhouseStatus[gh.id] = {
            ...ghData,
            ...evaluation,
            devices: this.ruleEngine.getDeviceStates(gh.id),
            alarms: this.ruleEngine.getAlarmStates(gh.id),
            online: onlineStatus.online,
            lastSeen: onlineStatus.lastSeen
          };
        } else {
          greenhouseStatus[gh.id] = {
            temperature: 25,
            humidity: 60,
            light: 10000,
            co2: 800,
            soilMoisture: 55,
            score: 75,
            scoreColor: '#FFC107',
            devices: { fan: false, spray: false, light: false },
            alarms: { highTemp: false, lowHumidity: false, highCO2: false },
            online: onlineStatus.online,
            lastSeen: onlineStatus.lastSeen,
            weights
          };
        }
      }
      
      this.sendTo(ws, {
        type: 'initial_data',
        greenhouses: greenhouseConfig.greenhouses,
        status: greenhouseStatus,
        thresholds: greenhouseConfig.thresholds,
        growthStages: this.evaluator.getGrowthStageWeightsInfo()
      });
    } catch (error) {
      console.error('[DataPush] 发送初始数据错误:', error.message);
    }
  }

  pushSensorUpdate(greenhouseId, sensorData, evaluation, devices, alarms, onlineStatus) {
    const broadcastData = {
      type: 'sensor_update',
      greenhouseId,
      data: {
        ...sensorData,
        ...evaluation,
        devices,
        alarms,
        online: onlineStatus.online,
        lastSeen: onlineStatus.lastSeen,
        timestamp: new Date().toISOString()
      }
    };
    
    this.broadcast(broadcastData);
  }

  pushAlarm(greenhouseId, alarmType, level, message) {
    const alarmData = {
      type: 'alarm',
      greenhouseId,
      alarmType,
      level,
      message,
      timestamp: new Date().toISOString()
    };
    
    this.broadcast(alarmData);
  }

  pushDeviceStatus(greenhouseId, device, state) {
    const statusData = {
      type: 'device_status',
      greenhouseId,
      device,
      state,
      timestamp: new Date().toISOString()
    };
    
    this.broadcast(statusData);
  }

  getConnectedClientsCount() {
    return this.clients.size;
  }

  stop() {
    if (this.wss) {
      this.wss.close();
      this.clients.clear();
    }
  }
}

module.exports = DataPush;
