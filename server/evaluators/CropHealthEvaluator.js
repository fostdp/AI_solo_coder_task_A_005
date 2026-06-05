const config = require('../../config');

class CropHealthEvaluator {
  constructor() {
    this.growthStageWeights = {
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
  }

  getGreenhouseInfo(greenhouseId) {
    const gh = config.greenhouses.find(g => g.id === greenhouseId);
    return gh || { crop: 'default', growthStage: 'vegetative' };
  }

  getWeights(greenhouseId) {
    const ghInfo = this.getGreenhouseInfo(greenhouseId);
    const growthStage = ghInfo.growthStage || 'vegetative';
    return this.growthStageWeights[growthStage] || config.weights;
  }

  getAllGrowthStages() {
    return Object.keys(this.growthStageWeights);
  }

  getGrowthStageWeightsInfo() {
    return this.growthStageWeights;
  }

  calculateScore(sensorData, greenhouseId) {
    const { thresholds } = config;
    const weights = this.getWeights(greenhouseId);

    const ideal = {
      temperature: (thresholds.temperature.min + thresholds.temperature.max) / 2,
      humidity: (thresholds.humidity.min + thresholds.humidity.max) / 2,
      light: (thresholds.light.min + thresholds.light.max) / 2
    };

    const tempRange = thresholds.temperature.max - thresholds.temperature.min;
    const humRange = thresholds.humidity.max - thresholds.humidity.min;
    const lightRange = thresholds.light.max - thresholds.light.min;

    const tempDeviation = Math.abs(sensorData.temperature - ideal.temperature) / tempRange;
    const humDeviation = Math.abs(sensorData.humidity - ideal.humidity) / humRange;
    const lightDeviation = Math.abs(sensorData.light - ideal.light) / lightRange;

    const score = 100 - (
      tempDeviation * weights.temperature * 100 +
      humDeviation * weights.humidity * 100 +
      lightDeviation * weights.light * 100
    );

    return Math.max(0, Math.min(100, score));
  }

  getScoreColor(score) {
    if (score > 80) return '#4CAF50';
    if (score >= 60) return '#FFC107';
    return '#F44336';
  }

  evaluate(sensorData, greenhouseId) {
    const score = this.calculateScore(sensorData, greenhouseId);
    return {
      score: parseFloat(score.toFixed(2)),
      scoreColor: this.getScoreColor(score),
      weights: this.getWeights(greenhouseId),
      growthStage: this.getGreenhouseInfo(greenhouseId).growthStage
    };
  }
}

module.exports = CropHealthEvaluator;
