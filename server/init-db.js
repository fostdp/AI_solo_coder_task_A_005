const { InfluxDB } = require('@influxdata/influxdb-client');
const { setup } = require('@influxdata/influxdb-client-apis');
require('dotenv').config();

const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
const token = process.env.INFLUXDB_TOKEN || 'my-super-secret-token';
const org = process.env.INFLUXDB_ORG || 'smart-agriculture';
const bucket = process.env.INFLUXDB_BUCKET || 'sensor_data';
const username = 'admin';
const password = 'admin123';

async function initDatabase() {
  console.log('正在初始化 InfluxDB 数据库...');
  
  const influxDB = new InfluxDB({ url, token });
  const setupApi = setup(influxDB);
  
  try {
    const result = await setupApi.postSetup({
      body: {
        org,
        bucket,
        username,
        password,
        token,
      },
    });
    
    console.log('✅ InfluxDB 初始化成功!');
    console.log(`组织: ${org}`);
    console.log(`存储桶: ${bucket}`);
    console.log(`用户名: ${username}`);
    console.log(`密码: ${password}`);
    console.log(`Token: ${token}`);
  } catch (error) {
    if (error.statusCode === 422) {
      console.log('ℹ️  InfluxDB 已初始化，跳过设置');
    } else {
      console.error('❌ 初始化失败:', error.message);
      console.log('请确保 InfluxDB 服务已启动并运行在 ' + url);
    }
  }
}

initDatabase();
