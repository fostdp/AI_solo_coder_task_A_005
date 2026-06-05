const mqtt = require('mqtt');
const EventEmitter = require('events');

class MqttGateway extends EventEmitter {
  constructor(options) {
    super();
    this.brokerUrl = options.brokerUrl;
    this.username = options.username;
    this.password = options.password;
    this.clientId = options.clientId || 'smart-agriculture-gateway-' + Math.random().toString(16).substr(2, 8);
    this.subscriptions = options.subscriptions || [];
    this.client = null;
    this.isConnected = false;
  }

  connect() {
    const options = {
      clientId: this.clientId,
      username: this.username || undefined,
      password: this.password || undefined,
      reconnectPeriod: 5000,
      connectTimeout: 30000
    };

    this.client = mqtt.connect(this.brokerUrl, options);

    this.client.on('connect', () => {
      this.isConnected = true;
      console.log('✅ [MqttGateway] MQTT 连接成功');
      this.subscribeAll();
      this.emit('connected');
    });

    this.client.on('reconnect', () => {
      console.log('🔄 [MqttGateway] MQTT 正在重连...');
      this.emit('reconnecting');
    });

    this.client.on('close', () => {
      this.isConnected = false;
      console.log('⚠️  [MqttGateway] MQTT 连接已断开');
      this.emit('disconnected');
    });

    this.client.on('error', (err) => {
      console.error('❌ [MqttGateway] MQTT 连接错误:', err.message);
      this.emit('error', err);
    });

    this.client.on('message', (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        this.handleMessage(topic, data);
      } catch (error) {
        console.error('[MqttGateway] 消息解析错误:', error.message);
      }
    });
  }

  handleMessage(topic, data) {
    const parts = topic.split('/');
    const greenhouseId = parts[1];
    const messageType = parts.slice(2).join('/');

    if (topic.includes('/sensor/data')) {
      this.emit('sensorData', { greenhouseId, data });
    } else if (topic.includes('/control/response')) {
      this.emit('controlResponse', { greenhouseId, data });
    } else if (topic.includes('/status/online')) {
      this.emit('deviceStatus', { greenhouseId, data });
    }
  }

  subscribeAll() {
    console.log('📡 [MqttGateway] 订阅 MQTT 主题...');
    this.subscriptions.forEach(topic => {
      this.client.subscribe(topic, (err) => {
        if (err) {
          console.error(`❌ [MqttGateway] 订阅失败 [${topic}]:`, err.message);
        } else {
          console.log(`✅ [MqttGateway] 订阅成功 [${topic}]`);
        }
      });
    });
  }

  publish(topic, message, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('MQTT未连接'));
        return;
      }

      const payload = typeof message === 'string' ? message : JSON.stringify(message);
      
      this.client.publish(topic, payload, { qos: options.qos || 1 }, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(true);
        }
      });
    });
  }

  sendControlCommand(greenhouseId, device, action, reason, metadata = {}) {
    const topic = `greenhouse/${greenhouseId}/control/${device}`;
    const message = {
      action,
      reason,
      timestamp: new Date().toISOString(),
      requestId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...metadata
    };
    return this.publish(topic, message, { qos: 1 });
  }

  disconnect() {
    if (this.client) {
      this.client.end();
      this.isConnected = false;
    }
  }
}

module.exports = MqttGateway;
