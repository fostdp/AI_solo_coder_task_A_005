# 智慧农业大棚系统 - Bug修复报告

## 修复概述

本次修复针对三个核心问题：
1. MQTT断线重连后主题订阅丢失
2. 综合评分权重固定，未支持生长阶段动态调整
3. 自动控制指令重试导致MQTT消息队列堵塞

---

## 问题一：MQTT断线重连后主题订阅丢失

### 问题定位过程

**现象描述**：
- MQTT客户端因网络波动或Broker重启断线后，自动重连成功
- 但传感器数据上报主题和控制响应主题的订阅丢失
- 导致服务器无法接收传感器数据，控制指令下发后设备无响应
- 重连后设备状态（风机、喷雾、补光）与实际不同步

**根因分析**：
1. 查看 `server/index.js:30-34` 原始代码
   - 仅在 `connect` 事件中执行订阅操作
   - MQTT.js 客户端重连时会触发 `reconnect` 事件，但**不会自动恢复之前的订阅**
   - 这是 MQTT 协议的标准行为（非持久会话情况下订阅不保留）

2. 缺少设备状态同步机制
   - 重连后服务器内存中的设备状态可能与实际设备状态不一致
   - 没有机制将服务器状态同步到设备端

### 改动范围

**修改文件**：`server/index.js`

**代码变更**：
```javascript
// 新增：定义需要订阅的主题列表常量
const MQTT_SUBSCRIPTIONS = [
  'greenhouse/+/sensor/data',
  'greenhouse/+/control/response',
  'greenhouse/+/status/online'  // 新增设备在线状态主题
];

// 新增：独立的订阅函数，可在connect和reconnect时调用
function subscribeTopics() {
  console.log('📡 重新订阅 MQTT 主题...');
  MQTT_SUBSCRIPTIONS.forEach(topic => {
    mqttClient.subscribe(topic, (err) => {
      if (err) {
        console.error(`❌ 订阅失败 [${topic}]:`, err.message);
      } else {
        console.log(`✅ 订阅成功 [${topic}]`);
      }
    });
  });
}

// 修改：connect事件处理
mqttClient.on('connect', () => {
  console.log('✅ MQTT 连接成功');
  subscribeTopics();                    // 调用统一订阅函数
  control.syncAllDeviceStates(mqttClient);  // 新增：同步所有设备状态
});

// 新增：重连事件监听
mqttClient.on('reconnect', () => {
  console.log('🔄 MQTT 正在重连...');
});

// 新增：连接关闭事件监听
mqttClient.on('close', () => {
  console.log('⚠️  MQTT 连接已断开');
});

// 新增：错误事件监听
mqttClient.on('error', (err) => {
  console.error('❌ MQTT 连接错误:', err.message);
});
```

**新增文件**：`server/control.js` 中新增 `syncAllDeviceStates` 函数
```javascript
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
```

**修复效果**：
- ✅ 重连后自动恢复所有主题订阅
- ✅ 重连后自动同步设备状态到实际设备
- ✅ 增加完整的MQTT连接生命周期日志
- ✅ 新增设备在线状态主题订阅

---

## 问题二：综合评分权重固定，未支持生长阶段动态调整

### 问题定位过程

**现象描述**：
- 查看 `server/control.js:28-51` 的 `calculateScore` 函数
- 权重直接从配置读取，固定为 `{temperature: 0.4, humidity: 0.35, light: 0.25}`
- 不同作物在不同生长阶段对环境参数的敏感度不同：
  - **苗期**：对温度敏感，温度过低会导致幼苗冻伤
  - **营养生长期**：需要充足光照进行光合作用
  - **开花期**：温湿度均衡影响授粉成功率
  - **结果期**：湿度影响果实膨大速度
  - **成熟期**：湿度影响糖分积累和果实品质
- 固定权重导致评分无法真实反映各生长阶段的环境适宜度

**根因分析**：
1. 设计时未考虑作物生长阶段的差异
2. 配置文件缺少生长阶段和对应权重的定义
3. `calculateScore` 函数缺少 `greenhouseId` 参数，无法根据大棚信息获取生长阶段

### 改动范围

**修改文件**：
1. `config/greenhouses.json` - 新增生长阶段配置
2. `server/control.js` - 重写评分计算逻辑
3. `server/index.js` - 更新API接口和数据广播

#### 1. 配置文件变更 (`config/greenhouses.json`)

**新增内容**：
```json
{
  "greenhouses": [
    // 每个大棚新增 growthStage 字段
    {"id": "GH001", ..., "growthStage": "flowering"},
    {"id": "GH002", ..., "growthStage": "fruiting"},
    ...
  ],
  
  // 新增生长阶段权重表
  "growthStageWeights": {
    "seedling": {
      "name": "苗期",
      "description": "温度权重较高，需要适宜温度促进幼苗生长",
      "weights": { "temperature": 0.45, "humidity": 0.35, "light": 0.20 }
    },
    "vegetative": {
      "name": "营养生长期",
      "description": "光照权重提高，促进光合作用和茎叶生长",
      "weights": { "temperature": 0.40, "humidity": 0.30, "light": 0.30 }
    },
    "flowering": {
      "name": "开花期",
      "description": "温湿度均衡，确保正常授粉",
      "weights": { "temperature": 0.35, "humidity": 0.35, "light": 0.30 }
    },
    "fruiting": {
      "name": "结果期",
      "description": "湿度权重较高，促进果实膨大",
      "weights": { "temperature": 0.35, "humidity": 0.40, "light": 0.25 }
    },
    "maturity": {
      "name": "成熟期",
      "description": "湿度权重最高，促进果实成熟和糖分积累",
      "weights": { "temperature": 0.30, "humidity": 0.45, "light": 0.25 }
    }
  }
}
```

#### 2. 控制逻辑变更 (`server/control.js`)

**新增生长阶段权重常量**：
```javascript
const growthStageWeights = {
  seedling:    { temperature: 0.45, humidity: 0.35, light: 0.20 },
  vegetative:  { temperature: 0.40, humidity: 0.30, light: 0.30 },
  flowering:   { temperature: 0.35, humidity: 0.35, light: 0.30 },
  fruiting:    { temperature: 0.35, humidity: 0.40, light: 0.25 },
  maturity:    { temperature: 0.30, humidity: 0.45, light: 0.25 }
};
```

**新增辅助函数**：
```javascript
function getGreenhouseInfo(greenhouseId) {
  const gh = config.greenhouses.find(g => g.id === greenhouseId);
  return gh || { crop: 'default', growthStage: 'vegetative' };
}

function getWeights(greenhouseId) {
  const ghInfo = getGreenhouseInfo(greenhouseId);
  const growthStage = ghInfo.growthStage || 'vegetative';
  return growthStageWeights[growthStage] || config.weights;
}
```

**修改 `calculateScore` 函数签名和实现**：
```javascript
// 原函数：function calculateScore(data)
// 新函数：接收 greenhouseId 参数，动态获取权重
function calculateScore(data, greenhouseId) {
  const { thresholds } = config;
  const weights = getWeights(greenhouseId);  // 动态获取当前生长阶段权重
  
  const ideal = {
    temperature: (thresholds.temperature.min + thresholds.temperature.max) / 2,
    humidity: (thresholds.humidity.min + thresholds.humidity.max) / 2,
    light: (thresholds.light.min + thresholds.light.max) / 2
  };
  
  // ... 评分计算逻辑不变，使用动态权重
}
```

#### 3. API接口新增 (`server/index.js`)

```javascript
// 获取所有生长阶段配置
app.get('/api/growth-stages', (req, res) => {
  res.json({
    stages: control.getGrowthStageWeightsInfo(),
    descriptions: greenhouseConfig.growthStageWeights
  });
});

// 修改大棚生长阶段
app.post('/api/greenhouses/:id/growth-stage', async (req, res) => {
  const { id } = req.params;
  const { growthStage } = req.body;
  // ... 验证并更新生长阶段
});
```

**修复效果**：
- ✅ 5个生长阶段各有不同的权重配置
- ✅ 评分根据大棚当前生长阶段动态计算
- ✅ 前端Tooltip和详情面板显示当前权重配置
- ✅ 支持通过API动态修改大棚生长阶段

---

## 问题三：自动控制指令重试导致MQTT消息队列堵塞

### 问题定位过程

**现象描述**：
- 设备离线时（如断电、网络断开），自动控制逻辑仍不断发送指令
- 查看 `server/control.js:155-165` 的 `sendControlCommand` 函数
- 原逻辑仅检查 MQTT 客户端是否连接，不检查目标设备是否在线
- 大量离线设备的控制指令持续发送，导致：
  - MQTT Broker 消息队列积压
  - 网络带宽浪费
  - 设备上线后瞬间接收大量过期指令
  - 数据库写入大量无效的控制记录

**根因分析**：
1. 缺少设备在线状态追踪机制
2. 控制指令发送前未做设备在线检查
3. 没有重试队列管理和重试次数限制
4. 无法感知设备何时上线

### 改动范围

**修改文件**：`server/control.js`

#### 新增状态管理变量

```javascript
// 设备在线状态追踪
const deviceOnlineStatus = {};
// 指令重试队列管理
const commandRetryQueue = {};
// 最后传感器数据接收时间（用于判断设备活跃度）
const lastSensorTime = {};

// 重试配置常量
const MAX_RETRY_COUNT = 3;      // 最大重试3次
const RETRY_INTERVAL = 5000;     // 重试间隔5秒
const OFFLINE_THRESHOLD = 120000; // 2分钟无数据视为离线
```

#### 新增设备在线状态管理函数

```javascript
function isDeviceOnline(greenhouseId) {
  initGreenhouse(greenhouseId);
  const status = deviceOnlineStatus[greenhouseId];
  const now = Date.now();
  // 同时检查在线标记和最后活跃时间
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
```

#### 新增重试队列管理函数

```javascript
async function retryCommand(greenhouseId, device, action, reason, mqttClient, retryCount = 0) {
  const queueKey = `${device}-${action}`;
  
  // 初始化队列项
  if (!commandRetryQueue[greenhouseId][queueKey]) {
    commandRetryQueue[greenhouseId][queueKey] = {
      retryCount,
      timer: null
    };
  }
  
  const queueItem = commandRetryQueue[greenhouseId][queueKey];
  
  // 超过最大重试次数，放弃并清理
  if (queueItem.retryCount >= MAX_RETRY_COUNT) {
    console.error(`❌ [${greenhouseId}] ${device} ${action} 重试${MAX_RETRY_COUNT}次失败，放弃`);
    delete commandRetryQueue[greenhouseId][queueKey];
    return false;
  }
  
  // 设备仍离线，等待重试
  if (!isDeviceOnline(greenhouseId)) {
    console.log(`⏳ [${greenhouseId}] 设备离线，等待重试 ${device} ${action} (${queueItem.retryCount + 1}/${MAX_RETRY_COUNT})`);
    queueItem.timer = setTimeout(async () => {
      queueItem.retryCount++;
      await retryCommand(greenhouseId, device, action, reason, mqttClient, queueItem.retryCount);
    }, RETRY_INTERVAL);
    return false;
  }
  
  // 设备已上线，清除定时器并重试
  if (queueItem.timer) {
    clearTimeout(queueItem.timer);
  }
  
  console.log(`🔄 [${greenhouseId}] 重试发送 ${device} ${action} (${queueItem.retryCount + 1}/${MAX_RETRY_COUNT})`);
  const result = await sendControlCommandInternal(mqttClient, greenhouseId, device, action, reason);
  
  if (!result) {
    // 发送失败，继续重试
    queueItem.timer = setTimeout(async () => {
      queueItem.retryCount++;
      await retryCommand(greenhouseId, device, action, reason, mqttClient, queueItem.retryCount);
    }, RETRY_INTERVAL);
  } else {
    // 发送成功，清理队列
    delete commandRetryQueue[greenhouseId][queueKey];
  }
  
  return result;
}
```

#### 重构控制指令发送逻辑

```javascript
// 内部发送函数（不做在线检查）
async function sendControlCommandInternal(mqttClient, greenhouseId, device, action, reason) {
  const topic = `greenhouse/${greenhouseId}/control/${device}`;
  const message = JSON.stringify({ 
    action, 
    reason, 
    timestamp: new Date().toISOString(),
    requestId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`  // 新增请求ID
  });
  
  if (!mqttClient || !mqttClient.connected) {
    console.error(`❌ [${greenhouseId}] MQTT未连接，无法发送 ${device} ${action}`);
    return false;
  }
  
  try {
    // 使用 QoS 1 确保消息送达
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

// 对外暴露的发送函数（做在线检查和重试管理）
async function sendControlCommand(mqttClient, greenhouseId, device, action, reason) {
  initGreenhouse(greenhouseId);
  
  if (!isDeviceOnline(greenhouseId)) {
    console.log(`⚠️  [${greenhouseId}] 设备离线，加入重试队列: ${device} ${action}`);
    await retryCommand(greenhouseId, device, action, reason, mqttClient, 0);
    return false;
  }
  
  return await sendControlCommandInternal(mqttClient, greenhouseId, device, action, reason);
}
```

#### 传感器数据接收时更新在线状态

```javascript
async function checkAlarms(greenhouseId, data, mqttClient) {
  initGreenhouse(greenhouseId);
  // ...
  
  // 收到传感器数据，更新在线状态
  lastSensorTime[greenhouseId] = now;
  updateDeviceOnlineStatus(greenhouseId, true);
  
  // ... 告警逻辑
}
```

**修复效果**：
- ✅ 设备离线时控制指令自动进入重试队列
- ✅ 最多重试3次，每次间隔5秒
- ✅ 超过重试次数自动放弃，避免队列无限增长
- ✅ 设备上线后自动触发待重试的指令
- ✅ 2分钟无数据自动标记为离线
- ✅ 控制指令使用 QoS 1 确保送达
- ✅ 前端显示设备在线/离线状态

---

## 前端配合更新

**修改文件**：`public/app.js`

1. **大棚色块显示优化**：
   - 离线设备降低透明度 (alpha = 0.4)
   - 离线设备使用虚线边框
   - 显示"离线"文字标识

2. **Tooltip 增强**：
   - 显示当前生长阶段（中文名称）
   - 显示设备在线状态（绿/红标识）
   - 底部显示当前权重配置信息

3. **详情面板增强**：
   - 新增"生长阶段"显示项
   - 新增"在线状态"显示项
   - 底部显示当前权重配置明细

---

## 配置文件更新

**新增字段说明** (`config/greenhouses.json`)：

| 字段 | 类型 | 说明 |
|------|------|------|
| `greenhouses[].growthStage` | string | 大棚当前生长阶段 |
| `growthStageWeights` | object | 各生长阶段权重配置 |
| `retryConfig` | object | 重试策略配置 |

**生长阶段可选值**：
- `seedling` - 苗期
- `vegetative` - 营养生长期
- `flowering` - 开花期
- `fruiting` - 结果期
- `maturity` - 成熟期

---

## 总结

| 问题 | 修复前 | 修复后 |
|------|--------|--------|
| **MQTT重连** | 订阅丢失，设备状态不同步 | 自动恢复订阅，同步设备状态 |
| **评分权重** | 固定：温40%/湿35%/光25% | 5个生长阶段动态权重 |
| **控制重试** | 无限发送，队列堵塞 | 最多3次重试，设备上线自动触发 |

**修改文件清单**：
- `server/index.js` - MQTT重连处理、新增API
- `server/control.js` - 权重计算、在线状态、重试队列
- `config/greenhouses.json` - 生长阶段配置
- `public/app.js` - 前端显示增强
