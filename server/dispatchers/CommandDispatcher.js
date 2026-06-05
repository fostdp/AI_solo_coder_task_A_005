const EventEmitter = require('events');
const db = require('../db');

class CommandDispatcher extends EventEmitter {
  constructor(mqttGateway, options = {}) {
    super();
    this.mqttGateway = mqttGateway;
    this.maxRetryCount = options.maxRetryCount || 3;
    this.retryIntervalMs = options.retryIntervalMs || 5000;
    this.offlineThresholdMs = options.offlineThresholdMs || 120000;
    
    this.commandRetryQueue = {};
    this.deviceOnlineStatus = {};
    this.lastSeenTime = {};
  }

  initGreenhouse(greenhouseId) {
    if (!this.commandRetryQueue[greenhouseId]) {
      this.commandRetryQueue[greenhouseId] = {};
    }
    if (!this.deviceOnlineStatus[greenhouseId]) {
      this.deviceOnlineStatus[greenhouseId] = {
        online: true,
        lastSeen: Date.now()
      };
    }
  }

  isDeviceOnline(greenhouseId) {
    this.initGreenhouse(greenhouseId);
    const status = this.deviceOnlineStatus[greenhouseId];
    const now = Date.now();
    return status.online && (now - status.lastSeen < this.offlineThresholdMs);
  }

  updateDeviceOnlineStatus(greenhouseId, online) {
    this.initGreenhouse(greenhouseId);
    this.deviceOnlineStatus[greenhouseId] = {
      online,
      lastSeen: Date.now()
    };
    this.lastSeenTime[greenhouseId] = Date.now();
    
    if (online) {
      console.log(`📡 [CommandDispatcher] [${greenhouseId}] 设备上线`);
      this.processPendingCommands(greenhouseId);
    } else {
      console.log(`📡 [CommandDispatcher] [${greenhouseId}] 设备离线`);
    }
  }

  updateLastSeen(greenhouseId) {
    this.initGreenhouse(greenhouseId);
    this.lastSeenTime[greenhouseId] = Date.now();
    this.deviceOnlineStatus[greenhouseId].lastSeen = Date.now();
  }

  getOnlineStatus(greenhouseId) {
    this.initGreenhouse(greenhouseId);
    return {
      online: this.isDeviceOnline(greenhouseId),
      lastSeen: this.deviceOnlineStatus[greenhouseId]?.lastSeen || 0
    };
  }

  async dispatch(greenhouseId, device, action, reason, metadata = {}) {
    this.initGreenhouse(greenhouseId);

    if (!this.isDeviceOnline(greenhouseId)) {
      console.log(`⚠️  [CommandDispatcher] [${greenhouseId}] 设备离线，加入重试队列: ${device} ${action}`);
      return this.enqueueRetry(greenhouseId, device, action, reason, metadata);
    }

    return this.sendCommand(greenhouseId, device, action, reason, metadata);
  }

  async sendCommand(greenhouseId, device, action, reason, metadata = {}) {
    try {
      await this.mqttGateway.sendControlCommand(greenhouseId, device, action, reason, metadata);
      await db.writeControlData(greenhouseId, device, action, reason);
      console.log(`🔧 [CommandDispatcher] [${greenhouseId}] ${device} ${action} - ${reason}`);
      this.emit('commandSent', { greenhouseId, device, action, reason });
      return true;
    } catch (error) {
      console.error(`❌ [CommandDispatcher] [${greenhouseId}] 发送控制指令失败:`, error.message);
      return this.enqueueRetry(greenhouseId, device, action, reason, metadata, 1);
    }
  }

  enqueueRetry(greenhouseId, device, action, reason, metadata = {}, retryCount = 0) {
    const queueKey = `${device}-${action}`;
    
    if (!this.commandRetryQueue[greenhouseId][queueKey]) {
      this.commandRetryQueue[greenhouseId][queueKey] = {
        retryCount,
        timer: null,
        reason,
        metadata
      };
    }

    const queueItem = this.commandRetryQueue[greenhouseId][queueKey];
    queueItem.retryCount = retryCount;

    if (retryCount >= this.maxRetryCount) {
      console.error(`❌ [CommandDispatcher] [${greenhouseId}] ${device} ${action} 重试${this.maxRetryCount}次失败，放弃`);
      delete this.commandRetryQueue[greenhouseId][queueKey];
      return false;
    }

    console.log(`⏳ [CommandDispatcher] [${greenhouseId}] 等待重试 ${device} ${action} (${retryCount + 1}/${this.maxRetryCount})`);

    if (queueItem.timer) {
      clearTimeout(queueItem.timer);
    }

    queueItem.timer = setTimeout(async () => {
      await this.processRetry(greenhouseId, device, action);
    }, this.retryIntervalMs);

    return false;
  }

  async processRetry(greenhouseId, device, action) {
    const queueKey = `${device}-${action}`;
    const queueItem = this.commandRetryQueue[greenhouseId]?.[queueKey];
    
    if (!queueItem) return;

    if (!this.isDeviceOnline(greenhouseId)) {
      queueItem.retryCount++;
      return this.enqueueRetry(greenhouseId, device, action, queueItem.reason, queueItem.metadata, queueItem.retryCount);
    }

    console.log(`🔄 [CommandDispatcher] [${greenhouseId}] 重试发送 ${device} ${action} (${queueItem.retryCount + 1}/${this.maxRetryCount})`);
    
    const result = await this.sendCommand(greenhouseId, device, action, queueItem.reason, queueItem.metadata);
    
    if (result) {
      if (queueItem.timer) {
        clearTimeout(queueItem.timer);
      }
      delete this.commandRetryQueue[greenhouseId][queueKey];
    } else {
      queueItem.retryCount++;
      return this.enqueueRetry(greenhouseId, device, action, queueItem.reason, queueItem.metadata, queueItem.retryCount);
    }

    return result;
  }

  processPendingCommands(greenhouseId) {
    const pendingCommands = this.commandRetryQueue[greenhouseId];
    if (!pendingCommands) return;

    Object.keys(pendingCommands).forEach(queueKey => {
      const [device, action] = queueKey.split('-');
      this.processRetry(greenhouseId, device, action);
    });
  }

  syncAllDeviceStates(deviceStates, greenhouseIds) {
    console.log('🔄 [CommandDispatcher] 同步所有设备状态...');
    
    greenhouseIds.forEach(greenhouseId => {
      this.initGreenhouse(greenhouseId);
      const devices = deviceStates[greenhouseId] || {};
      
      Object.entries(devices).forEach(([device, state]) => {
        if (state) {
          this.dispatch(greenhouseId, device, 'ON', '重连同步状态');
        }
      });
    });
    
    console.log('✅ [CommandDispatcher] 设备状态同步完成');
  }

  clearAllRetries() {
    Object.values(this.commandRetryQueue).forEach(queue => {
      Object.values(queue).forEach(item => {
        if (item.timer) {
          clearTimeout(item.timer);
        }
      });
    });
    this.commandRetryQueue = {};
  }
}

module.exports = CommandDispatcher;
