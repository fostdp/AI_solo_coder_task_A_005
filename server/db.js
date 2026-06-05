const { InfluxDB, Point } = require('@influxdata/influxdb-client');
require('dotenv').config();

const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
const token = process.env.INFLUXDB_TOKEN || 'my-super-secret-token';
const org = process.env.INFLUXDB_ORG || 'smart-agriculture';
const bucket = process.env.INFLUXDB_BUCKET || 'sensor_data';

const influxDB = new InfluxDB({ url, token });
const writeApi = influxDB.getWriteApi(org, bucket);
const queryApi = influxDB.getQueryApi(org);

writeApi.useDefaultTags({ source: 'sensor' });

async function writeSensorData(greenhouseId, data) {
  const point = new Point('sensor_data')
    .tag('greenhouseId', greenhouseId)
    .floatField('temperature', data.temperature)
    .floatField('humidity', data.humidity)
    .floatField('light', data.light)
    .floatField('co2', data.co2)
    .floatField('soilMoisture', data.soilMoisture);
  
  writeApi.writePoint(point);
  await writeApi.flush();
}

async function writeAlarmData(greenhouseId, alarmType, message, level) {
  const point = new Point('alarm_data')
    .tag('greenhouseId', greenhouseId)
    .tag('alarmType', alarmType)
    .tag('level', level)
    .stringField('message', message);
  
  writeApi.writePoint(point);
  await writeApi.flush();
}

async function writeControlData(greenhouseId, device, action, reason) {
  const point = new Point('control_data')
    .tag('greenhouseId', greenhouseId)
    .tag('device', device)
    .tag('action', action)
    .stringField('reason', reason);
  
  writeApi.writePoint(point);
  await writeApi.flush();
}

async function getSensorData(greenhouseId, startTime = '-24h') {
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${startTime})
      |> filter(fn: (r) => r._measurement == "sensor_data" and r.greenhouseId == "${greenhouseId}")
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"])
  `;
  
  return await queryApi.collectRows(fluxQuery);
}

async function getLatestSensorData(greenhouseId) {
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -1h)
      |> filter(fn: (r) => r._measurement == "sensor_data" and r.greenhouseId == "${greenhouseId}")
      |> last()
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  `;
  
  const rows = await queryApi.collectRows(fluxQuery);
  return rows.length > 0 ? rows[0] : null;
}

async function getAllLatestData() {
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => r._measurement == "sensor_data")
      |> group(columns: ["greenhouseId"])
      |> last()
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  `;
  
  return await queryApi.collectRows(fluxQuery);
}

async function getAlarms(startTime = '-24h') {
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${startTime})
      |> filter(fn: (r) => r._measurement == "alarm_data")
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
  `;
  
  return await queryApi.collectRows(fluxQuery);
}

async function getGreenhouseAlarms(greenhouseId, startTime = '-24h') {
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${startTime})
      |> filter(fn: (r) => r._measurement == "alarm_data" and r.greenhouseId == "${greenhouseId}")
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
  `;
  
  return await queryApi.collectRows(fluxQuery);
}

async function getControlHistory(greenhouseId, startTime = '-24h') {
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${startTime})
      |> filter(fn: (r) => r._measurement == "control_data" and r.greenhouseId == "${greenhouseId}")
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
  `;
  
  return await queryApi.collectRows(fluxQuery);
}

module.exports = {
  writeSensorData,
  writeAlarmData,
  writeControlData,
  getSensorData,
  getLatestSensorData,
  getAllLatestData,
  getAlarms,
  getGreenhouseAlarms,
  getControlHistory
};
