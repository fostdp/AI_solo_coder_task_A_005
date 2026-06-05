const staticConfig = require('./greenhouses.json');
const layoutConfig = require('./layout.config');

function mergeWithDynamicLayout(staticConfig) {
  const dynamicGreenhouses = layoutConfig.getGreenhouses();
  
  const mergedGreenhouses = staticConfig.greenhouses.map((gh, index) => {
    const dynamicGh = dynamicGreenhouses[index];
    if (dynamicGh) {
      return {
        ...gh,
        x: dynamicGh.x,
        y: dynamicGh.y,
        width: dynamicGh.width,
        height: dynamicGh.height,
        row: dynamicGh.row,
        col: dynamicGh.col,
        zone: dynamicGh.zone
      };
    }
    return gh;
  });
  
  return {
    ...staticConfig,
    greenhouses: mergedGreenhouses,
    layout: layoutConfig.getLayoutInfo(),
    layoutConfig: {
      useDynamicLayout: true,
      generatorOptions: {
        canvasWidth: 1080,
        canvasHeight: 420,
        greenhouseWidth: 80,
        greenhouseHeight: 50,
        cols: 10,
        rows: 5,
        hSpacing: 20,
        vSpacing: 20,
        padding: 50
      }
    }
  };
}

const config = mergeWithDynamicLayout(staticConfig);

config.getGreenhouseById = (id) => {
  return config.greenhouses.find(g => g.id === id);
};

config.getGreenhousesByCrop = (crop) => {
  return config.greenhouses.filter(g => g.crop === crop);
};

config.getGreenhousesByZone = (zone) => {
  return config.greenhouses.filter(g => g.zone === zone);
};

config.getGreenhousesByGrowthStage = (stage) => {
  return config.greenhouses.filter(g => g.growthStage === stage);
};

config.updateGrowthStage = (greenhouseId, stage) => {
  const gh = config.getGreenhouseById(greenhouseId);
  if (gh) {
    gh.growthStage = stage;
    return true;
  }
  return false;
};

config.getLayout = () => {
  return config.layout;
};

config.getGrowthStageDescriptions = () => {
  return config.growthStageWeights;
};

module.exports = config;
