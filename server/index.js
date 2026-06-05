const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const db = require('./db');
const config = require('../config');
const MqttGateway = require('./gateways/MqttGateway');
const CropHealthEvaluator = require('./evaluators/CropHealthEvaluator');
const CommandDispatcher = require('./dispatchers/CommandDispatcher');
const RuleEngine = require('./engines/RuleEngine');
const DataPush = require('./pushers/DataPush');

const app = express();
const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const MQTT_SUBSCRIPTIONS = [
  'greenhouse/+/sensor/data',
  'greenhouse/+/control/response',
  'greenhouse/+/status/online'
];

const evaluator = new CropHealthEvaluator();

const mqttGateway = new MqttGateway({
  brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  subscriptions: MQTT_SUBSCRIPTIONS
});

const commandDispatcher = new CommandDispatcher(mqttGateway, config.retryConfig);
const ruleEngine = new RuleEngine(commandDispatcher);
const dataPush = new DataPush(WS_PORT, evaluator, ruleEngine, commandDispatcher);

async function handleSensorData(greenhouseId, sensorData) {
  await db.writeSensorData(greenhouseId, sensorData);
  
  const ruleResults = await ruleEngine.processSensorData(greenhouseId, sensorData);
  const evaluation = evaluator.evaluate(sensorData, greenhouseId);
  const onlineStatus = commandDispatcher.getOnlineStatus(greenhouseId);
  
  dataPush.pushSensorUpdate(
    greenhouseId,
    sensorData,
    evaluation,
    ruleResults.devices,
    ruleResults.alarms,
    onlineStatus
  );
}

mqttGateway.on('sensorData', async ({ greenhouseId, data }) => {
  await handleSensorData(greenhouseId, data);
});

mqttGateway.on('controlResponse', ({ greenhouseId, data }) => {
  console.log(`📡 [Server] 收到设备响应 [${greenhouseId}]:`, data);
});

mqttGateway.on('deviceStatus', ({ greenhouseId, data }) => {
  console.log(`📡 [Server] 设备状态更新 [${greenhouseId}]:`, data);
});

mqttGateway.on('connected', () => {
  commandDispatcher.syncAllDeviceStates(
    ruleEngine.getAllDeviceStates(),
    config.greenhouses.map(g => g.id)
  );
});

mqttGateway.connect();
dataPush.start();

app.get('/api/greenhouses', (req, res) => {
  res.json(config.greenhouses);
});

app.get('/api/greenhouses/:id/data', async (req, res) => {
  try {
    const { id } = req.params;
    const { range = '-24h' } = req.query;
    const data = await db.getSensorData(id, range);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/greenhouses/:id/alarms', async (req, res) => {
  try {
    const { id } = req.params;
    const { range = '-24h' } = req.query;
    const data = await db.getGreenhouseAlarms(id, range);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/greenhouses/:id/control-history', async (req, res) => {
  try {
    const { id } = req.params;
    const { range = '-24h' } = req.query;
    const data = await db.getControlHistory(id, range);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/alarms', async (req, res) => {
  try {
    const { range = '-24h' } = req.query;
    const data = await db.getAlarms(range);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/greenhouses/:id/control', async (req, res) => {
  try {
    const { id } = req.params;
    const { device, action, reason } = req.body;
    
    const success = await commandDispatcher.dispatch(
      id,
      device,
      action,
      reason || '手动控制',
      { manual: true }
    );
    
    if (success) {
      ruleEngine.setDeviceState(id, device, action === 'ON');
      res.json({ success: true, message: '控制指令已发送' });
    } else {
      res.json({ success: false, message: '设备离线，指令已加入重试队列' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    thresholds: config.thresholds,
    weights: config.weights,
    growthStageWeights: config.growthStageWeights,
    retryConfig: config.retryConfig,
    layout: config.layout,
    layoutConfig: config.layoutConfig
  });
});

app.get('/api/growth-stages', (req, res) => {
  res.json({
    stages: evaluator.getGrowthStageWeightsInfo(),
    descriptions: config.growthStageWeights
  });
});

app.get('/api/greenhouses/:id/online-status', (req, res) => {
  const { id } = req.params;
  res.json(commandDispatcher.getOnlineStatus(id));
});

app.post('/api/greenhouses/:id/growth-stage', async (req, res) => {
  try {
    const { id } = req.params;
    const { growthStage } = req.body;
    
    const gh = config.getGreenhouseById(id);
    if (!gh) {
      return res.status(404).json({ error: '大棚不存在' });
    }
    
    if (!evaluator.getAllGrowthStages().includes(growthStage)) {
      return res.status(400).json({ error: '无效的生长阶段' });
    }
    
    config.updateGrowthStage(id, growthStage);
    res.json({ success: true, message: '生长阶段已更新', growthStage });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/layout', (req, res) => {
  res.json(config.getLayout());
});

app.listen(PORT, () => {
  console.log(`🚀 HTTP 服务器运行在 http://localhost:${PORT}`);
  console.log(`🔌 WebSocket 服务器运行在 ws://localhost:${WS_PORT}`);
  console.log(`📡 MQTT 连接到 ${process.env.MQTT_BROKER_URL}`);
  console.log(`🏗️  架构: MqttGateway -> RuleEngine -> DataPush`);
});

process.on('SIGINT', () => {
  console.log('\n👋 正在关闭服务...');
  commandDispatcher.clearAllRetries();
  mqttGateway.disconnect();
  dataPush.stop();
  process.exit(0);
});
