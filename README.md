# 智慧农业大棚环境调控系统

基于 Node.js + InfluxDB + MQTT + WebSocket 的全栈智慧农业大棚环境监控与自动调控系统，支持50个大棚实时监控、自动控制、告警管理和综合评分。

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         前端 (Canvas + WebSocket)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  园区平面图   │  │  趋势曲线图   │  │  大棚对比     │               │
│  │  (50大棚色块) │  │  (24h Canvas) │  │  (双棚对比)   │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                 │                  │                        │
│         └─────────────────┼──────────────────┘                        │
│                           │ WebSocket (ws://localhost:8080)           │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────────┐
│                     后端 (Node.js + Express)                         │
│                           │                                          │
│  ┌────────────┐    ┌──────▼───────┐    ┌────────────────┐           │
│  │ MqttGateway│◄───┤  RuleEngine  │───►│CommandDispatcher│           │
│  │ (设备通信)  │    │ (规则引擎)    │    │ (指令分发/重试) │           │
│  └──────┬─────┘    └──────┬───────┘    └───────┬────────┘           │
│         │                 │                     │                     │
│         │          ┌──────▼───────┐     ┌───────▼────────┐           │
│         │          │CropHealth    │     │  DataPush      │           │
│         │          │Evaluator     │     │  (WebSocket)   │           │
│         │          │ (健康评估)    │     │  (前端推送)     │           │
│         │          └──────────────┘     └────────────────┘           │
│         │                                                              │
│  ┌──────▼─────────────────────────────────────────────────┐          │
│  │                    InfluxDB (时序数据库)                  │          │
│  │  sensor_data │ alarm_data │ control_data               │          │
│  └────────────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
     ┌────────▼───┐  ┌─────▼─────┐  ┌───▼────────┐
     │  Mosquitto  │  │  传感器    │  │  控制设备   │
     │  (MQTT      │  │  (模拟器)  │  │  (风机/喷雾 │
     │   Broker)   │  │            │  │   /补光)    │
     └─────────────┘  └────────────┘  └────────────┘
```

### 数据流

```
传感器 → MQTT(greenhouse/{id}/sensor/data) → MqttGateway → RuleEngine → DataPush → WebSocket → 前端
                                                                      ↓
                                                            CommandDispatcher → MqttGateway → MQTT(greenhouse/{id}/control/{device}) → 设备
```

---

## 功能特性

### 核心功能
- **50个大棚实时监控** — 温度、湿度、光照、CO2浓度、土壤含水率，每30秒上报
- **综合评分系统** — 基于作物生长阶段的动态权重评分（苗期/营养生长/开花/结果/成熟）
- **自动控制** — 风机、喷雾、补光根据阈值自动启停，含滞回策略
- **告警系统** — 高温5分钟/低湿10分钟/CO2超标即时告警
- **园区平面图** — Canvas绘制50个大棚色块，绿>80/黄60-80/红<60
- **24h趋势图** — 点击大棚查看五项数据趋势，支持双棚对比

### 重构后架构特性
- **MqttGateway** — 独立设备通信层，EventEmitter事件驱动，自动重连重订阅
- **RuleEngine** — 独立规则引擎层，告警检测+自动控制决策
- **CommandDispatcher** — 独立指令分发层，在线检查+3次重试+队列管理
- **CropHealthEvaluator** — 独立健康评估模块，5阶段动态权重
- **DataPush** — 独立数据推送层，WebSocket广播管理
- **动态布局** — 配置驱动的园区平面图坐标生成

---

## 快速部署

### 方式一：Docker Compose 一键部署（推荐）

**前提**：安装 [Docker](https://docs.docker.com/get-docker/) 和 [Docker Compose](https://docs.docker.com/compose/install/)

```bash
# 1. 克隆项目
git clone <repo-url>
cd smart-agriculture-system

# 2. 构建并启动所有服务
docker-compose up -d

# 3. 查看日志
docker-compose logs -f
```

启动后访问：
- 前端界面：http://localhost:3000
- InfluxDB 管理面板：http://localhost:8086（admin / admin123456）
- MQTT Broker：mqtt://localhost:1883
- WebSocket：ws://localhost:8080

### 方式二：本地开发部署

**前提**：Node.js 16+、InfluxDB 2.x、Mosquitto

```bash
# 1. 安装依赖
npm install

# 2. 启动依赖服务（如果不用 Docker）
#    - InfluxDB: 默认 http://localhost:8086
#    - Mosquitto: 默认 mqtt://localhost:1883

# 3. 初始化 InfluxDB
npm run init-db

# 4. 启动主服务
npm start

# 5. 另开终端，启动传感器模拟器
npm run simulator
```

### Docker 常用命令

```bash
# 启动
npm run docker:up

# 停止
npm run docker:down

# 重建镜像
npm run docker:build

# 查看日志
npm run docker:logs

# 重启
npm run docker:restart
```

---

## 项目结构

```
smart-agriculture-system/
├── config/
│   ├── greenhouses.json         # 大棚配置（50个大棚 + 阈值 + 权重）
│   ├── layout.config.js         # 动态布局生成器（网格坐标计算）
│   └── index.js                 # 统一配置导出（合并动态布局）
├── docker/
│   ├── mosquitto/
│   │   └── mosquitto.conf       # Mosquitto MQTT 配置
│   └── app/
│       └── .env.docker          # Docker 环境变量
├── public/
│   ├── index.html               # 前端页面
│   ├── style.css                # 样式（暗色主题）
│   └── app.js                   # 前端逻辑（Canvas + WebSocket）
├── server/
│   ├── gateways/
│   │   └── MqttGateway.js       # MQTT 设备通信网关
│   ├── engines/
│   │   └── RuleEngine.js        # 规则引擎（告警 + 自动控制）
│   ├── evaluators/
│   │   └── CropHealthEvaluator.js  # 作物健康评估（动态权重评分）
│   ├── dispatchers/
│   │   └── CommandDispatcher.js # 指令分发器（在线检查 + 重试队列）
│   ├── pushers/
│   │   └── DataPush.js          # WebSocket 数据推送
│   ├── control.js               # 遗留兼容模块
│   ├── db.js                    # InfluxDB 数据库操作
│   ├── index.js                 # 主服务入口
│   ├── init-db.js               # 数据库初始化脚本
│   └── simulator.js             # 增强型传感器模拟器
├── .env                         # 环境变量
├── Dockerfile                   # 应用 Docker 镜像
├── docker-compose.yml           # Docker Compose 编排
├── package.json
└── README.md
```

---

## 大棚配置文件格式

### config/greenhouses.json

```json
{
  "greenhouses": [
    {
      "id": "GH001",
      "name": "番茄大棚1号",
      "crop": "番茄",
      "growthStage": "flowering"
    }
  ],
  "thresholds": {
    "temperature":  { "min": 18, "max": 30, "alarmMax": 35, "alarmDuration": 300 },
    "humidity":     { "min": 50, "max": 80, "alarmMin": 30, "alarmDuration": 600 },
    "light":        { "min": 5000, "max": 20000 },
    "co2":          { "min": 400, "max": 1500, "alarmMax": 2000 },
    "soilMoisture": { "min": 40, "max": 70 }
  },
  "weights": {
    "temperature": 0.4,
    "humidity": 0.35,
    "light": 0.25
  },
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
  },
  "retryConfig": {
    "maxRetryCount": 3,
    "retryIntervalMs": 5000,
    "offlineThresholdMs": 120000
  }
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 大棚唯一标识，格式 GH001-GH050 |
| name | string | 是 | 大棚名称 |
| crop | string | 是 | 作物类型（番茄/黄瓜/草莓/生菜/辣椒/茄子/西瓜/甜瓜/葡萄/猕猴桃） |
| growthStage | string | 是 | 生长阶段（seedling/vegetative/flowering/fruiting/maturity） |

注意：x、y、width、height 坐标由 config/layout.config.js 动态生成，无需手动配置。

### 动态布局配置

通过 config/layout.config.js 修改布局参数：

```javascript
new GreenhouseLayoutGenerator({
  canvasWidth: 1080,      // 画布宽度
  canvasHeight: 420,      // 画布高度
  greenhouseWidth: 80,    // 大棚宽度
  greenhouseHeight: 50,   // 大棚高度
  cols: 10,               // 列数
  rows: 5,                // 行数
  hSpacing: 20,           // 水平间距
  vSpacing: 20,           // 垂直间距
  padding: 50             // 边距
})
```

---

## 环境变量

### .env（本地开发）

```env
PORT=3000
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=
MQTT_PASSWORD=
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=my-super-secret-token
INFLUXDB_ORG=smart-agriculture
INFLUXDB_BUCKET=sensor_data
WS_PORT=8080
```

### docker/app/.env.docker（Docker 部署）

```env
PORT=3000
MQTT_BROKER_URL=mqtt://mosquitto:1883
INFLUXDB_URL=http://influxdb:8086
INFLUXDB_TOKEN=my-super-secret-token
INFLUXDB_ORG=smart-agriculture
INFLUXDB_BUCKET=sensor_data
WS_PORT=8080
```

### 模拟器环境变量

```env
SIM_INTERVAL_MS=30000     # 数据上报间隔（毫秒），默认 30000
SIM_STAGGER_MS=100        # 大棚间发送延迟（毫秒），默认 100
SIM_OFFLINE=false         # 是否启用离线模拟，默认 false
SIM_OFFLINE_GH=GH001,GH002  # 模拟离线的大棚ID，逗号分隔
```

---

## 模拟器

增强型大棚设备模拟器支持：

### 作物传感器配置

每种作物有独立的传感器基线值和波动参数：

| 作物 | 温度基线 | 湿度基线 | 光照基线 | CO2基线 | 土壤基线 |
|------|---------|---------|---------|---------|---------|
| 番茄 | 25度 | 65% | 12000lux | 800ppm | 55% |
| 黄瓜 | 26度 | 70% | 14000lux | 750ppm | 60% |
| 草莓 | 22度 | 60% | 10000lux | 700ppm | 50% |
| 其他 | 24度 | 60% | 11000lux | 800ppm | 55% |

### 控制指令响应

模拟器接收控制指令后模拟设备效果：

| 设备 | 动作 | 温度效果 | 湿度效果 | 光照效果 | 土壤效果 |
|------|------|---------|---------|---------|---------|
| 风机 | ON | -2度 | -3% | -- | -- |
| 喷雾 | ON | -- | +10% | -- | +3% |
| 补光 | ON | -- | -- | +5000lux | -- |

### 日夜模拟

- 白天 (6:00-18:00)：光照波动幅度为1.0
- 夜间 (18:00-6:00)：光照波动幅度降为0.2
- 温度有正弦周期性波动

### 离线模拟

```bash
SIM_OFFLINE=true SIM_OFFLINE_GH=GH001,GH002 npm run simulator
```

---

## MQTT 主题规范

### 传感器数据上报
```
Topic:   greenhouse/{greenhouseId}/sensor/data
Payload: {
  "temperature": 25.5,
  "humidity": 65.2,
  "light": 12000,
  "co2": 850,
  "soilMoisture": 58.5,
  "timestamp": "2026-06-02T10:30:00.000Z"
}
```

### 控制指令下发
```
Topic:   greenhouse/{greenhouseId}/control/{device}    // device: fan | spray | light
Payload: {
  "action": "ON",
  "reason": "温度过高: 32.5度",
  "timestamp": "2026-06-02T10:30:00.000Z",
  "requestId": "1748...-abc123",
  "manual": false
}
```

### 控制响应
```
Topic:   greenhouse/{greenhouseId}/control/response
Payload: {
  "device": "fan",
  "action": "ON",
  "status": "executed",
  "timestamp": "2026-06-02T10:30:00.000Z"
}
```

### 设备在线状态
```
Topic:   greenhouse/{greenhouseId}/status/online
```

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/greenhouses | 大棚列表 |
| GET | /api/greenhouses/:id/data?range=-24h | 大棚历史数据 |
| GET | /api/greenhouses/:id/alarms?range=-24h | 大棚告警记录 |
| GET | /api/greenhouses/:id/control-history?range=-24h | 控制历史 |
| GET | /api/greenhouses/:id/online-status | 设备在线状态 |
| POST | /api/greenhouses/:id/control | 手动控制设备 |
| POST | /api/greenhouses/:id/growth-stage | 修改生长阶段 |
| GET | /api/alarms?range=-24h | 全部告警 |
| GET | /api/config | 系统配置 |
| GET | /api/layout | 布局配置 |
| GET | /api/growth-stages | 生长阶段权重表 |

---

## Docker Compose 服务说明

| 服务 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| mosquitto | eclipse-mosquitto:2.0.15 | 1883 | MQTT Broker，带健康检查 |
| influxdb | influxdb:2.7-alpine | 8086 | 时序数据库，自动初始化 |
| app | 自构建 | 3000, 8080 | 主应用（HTTP + WebSocket） |
| simulator | 自构建 | -- | 传感器模拟器 |

### 启动顺序

```
mosquitto (健康) -> influxdb (健康) -> app -> simulator
```

InfluxDB 通过 DOCKER_INFLUXDB_INIT_MODE=setup 自动完成首次初始化（创建组织、存储桶、管理员），无需手动执行 init-db.js。

### 数据持久化

Docker Compose 使用命名卷持久化数据：

| 卷名 | 挂载点 | 说明 |
|------|--------|------|
| mosquitto_data | /var/lib/mosquitto | MQTT 消息持久化 |
| influxdb_data | /var/lib/influxdb2 | InfluxDB 数据 |
| influxdb_config | /etc/influxdb2 | InfluxDB 配置 |

---

## 综合评分算法

```
分数 = 100 - (温度偏离度 * Wt + 湿度偏离度 * Wh + 光照偏离度 * Wl) * 100

偏离度 = |实际值 - 理想值| / 理想范围
理想值 = (阈值上限 + 阈值下限) / 2
理想范围 = 阈值上限 - 阈值下限
```

权重根据生长阶段动态调整：

| 生长阶段 | 温度 Wt | 湿度 Wh | 光照 Wl | 农业逻辑 |
|----------|---------|---------|---------|----------|
| 苗期 | 45% | 35% | 20% | 保温促苗 |
| 营养生长 | 40% | 30% | 30% | 促光合作用 |
| 开花期 | 35% | 35% | 30% | 均衡授粉 |
| 结果期 | 35% | 40% | 25% | 促果实膨大 |
| 成熟期 | 30% | 45% | 25% | 促糖分积累 |

---

## 自动控制规则

| 设备 | 触发条件 | 关闭条件 | 滞回 |
|------|----------|----------|------|
| 风机 | 温度 > 30度 | 温度 < 20度 | 2度 |
| 喷雾 | 湿度 < 50% | 湿度 > 60% | 10% |
| 补光 | 光照 < 5000lux | 光照 > 8000lux | 3000lux |

### 告警规则

| 告警 | 条件 | 持续时间 | 级别 |
|------|------|----------|------|
| 高温告警 | 温度 >= 35度 | 5分钟 | critical |
| 低湿告警 | 湿度 <= 30% | 10分钟 | warning |
| CO2告警 | CO2 >= 2000ppm | 即时 | warning |

### 指令重试机制

- 设备离线时指令自动进入重试队列
- 最多重试 3 次，间隔 5 秒
- 2 分钟无数据标记设备离线
- 设备上线后自动触发待重试指令

---

## 许可证

MIT License
