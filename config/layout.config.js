class GreenhouseLayoutGenerator {
  constructor(options = {}) {
    this.canvasWidth = options.canvasWidth || 1080;
    this.canvasHeight = options.canvasHeight || 420;
    this.greenhouseWidth = options.greenhouseWidth || 80;
    this.greenhouseHeight = options.greenhouseHeight || 50;
    this.cols = options.cols || 10;
    this.rows = options.rows || 5;
    this.hSpacing = options.hSpacing || 20;
    this.vSpacing = options.vSpacing || 20;
    this.padding = options.padding || 50;
  }

  generateGreenhousePositions() {
    const positions = [];
    const totalWidth = this.cols * this.greenhouseWidth + (this.cols - 1) * this.hSpacing;
    const totalHeight = this.rows * this.greenhouseHeight + (this.rows - 1) * this.vSpacing;
    
    const startX = (this.canvasWidth - totalWidth) / 2;
    const startY = (this.canvasHeight - totalHeight) / 2;

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const index = row * this.cols + col;
        positions.push({
          index,
          x: startX + col * (this.greenhouseWidth + this.hSpacing),
          y: startY + row * (this.greenhouseHeight + this.vSpacing),
          width: this.greenhouseWidth,
          height: this.greenhouseHeight,
          row,
          col
        });
      }
    }
    
    return positions;
  }

  generateGreenhouseConfig(greenhouseTypes) {
    const positions = this.generateGreenhousePositions();
    const greenhouses = [];
    
    positions.forEach((pos, index) => {
      const typeIndex = Math.floor(index / 5) % greenhouseTypes.length;
      const type = greenhouseTypes[typeIndex];
      const growthStages = ['seedling', 'vegetative', 'flowering', 'fruiting', 'maturity'];
      
      greenhouses.push({
        id: `GH${String(index + 1).padStart(3, '0')}`,
        name: `${type.name}大棚${(index % 5) + 1}号`,
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        width: pos.width,
        height: pos.height,
        crop: type.crop,
        growthStage: growthStages[index % growthStages.length],
        row: pos.row,
        col: pos.col,
        zone: type.zone
      });
    });
    
    return greenhouses;
  }

  getLayoutInfo() {
    const positions = this.generateGreenhousePositions();
    return {
      canvas: {
        width: this.canvasWidth,
        height: this.canvasHeight
      },
      greenhouse: {
        width: this.greenhouseWidth,
        height: this.greenhouseHeight
      },
      grid: {
        cols: this.cols,
        rows: this.rows,
        hSpacing: this.hSpacing,
        vSpacing: this.vSpacing,
        padding: this.padding
      },
      total: positions.length
    };
  }
}

const greenhouseTypes = [
  { name: '番茄', crop: '番茄', zone: 'A' },
  { name: '黄瓜', crop: '黄瓜', zone: 'B' },
  { name: '草莓', crop: '草莓', zone: 'C' },
  { name: '生菜', crop: '生菜', zone: 'D' },
  { name: '辣椒', crop: '辣椒', zone: 'E' },
  { name: '茄子', crop: '茄子', zone: 'F' },
  { name: '西瓜', crop: '西瓜', zone: 'G' },
  { name: '甜瓜', crop: '甜瓜', zone: 'H' },
  { name: '葡萄', crop: '葡萄', zone: 'I' },
  { name: '猕猴桃', crop: '猕猴桃', zone: 'J' }
];

const layoutConfig = {
  generator: new GreenhouseLayoutGenerator({
    canvasWidth: 1080,
    canvasHeight: 420,
    greenhouseWidth: 80,
    greenhouseHeight: 50,
    cols: 10,
    rows: 5,
    hSpacing: 20,
    vSpacing: 20,
    padding: 50
  }),
  
  greenhouseTypes,
  
  getGreenhouses() {
    return this.generator.generateGreenhouseConfig(this.greenhouseTypes);
  },
  
  getLayoutInfo() {
    return this.generator.getLayoutInfo();
  },
  
  findByZone(zone) {
    return this.getGreenhouses().filter(g => g.zone === zone);
  },
  
  findByRow(row) {
    return this.getGreenhouses().filter(g => g.row === row);
  },
  
  findByCol(col) {
    return this.getGreenhouses().filter(g => g.col === col);
  }
};

if (require.main === module) {
  console.log(JSON.stringify(layoutConfig.getLayoutInfo(), null, 2));
}

module.exports = layoutConfig;
