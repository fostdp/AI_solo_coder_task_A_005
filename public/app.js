class GreenhouseSystem {
    constructor() {
        this.ws = null;
        this.greenhouses = [];
        this.greenhouseStatus = {};
        this.selectedGreenhouse = null;
        this.compareMode = false;
        this.compareGreenhouses = [];
        this.currentChartType = 'temperature';
        this.trendData = [];
        this.tooltip = null;
        
        this.init();
    }
    
    init() {
        this.setupCanvas();
        this.setupWebSocket();
        this.setupEventListeners();
        this.createTooltip();
        this.updateTime();
        setInterval(() => this.updateTime(), 1000);
    }
    
    setupCanvas() {
        this.canvas = document.getElementById('greenhouseCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.trendChartCanvas = document.getElementById('trendChart');
        this.trendChartCtx = this.trendChartCanvas.getContext('2d');
    }
    
    setupWebSocket() {
        const wsUrl = `ws://${window.location.hostname}:8080`;
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            this.updateConnectionStatus('connected');
        };
        
        this.ws.onclose = () => {
            this.updateConnectionStatus('disconnected');
            setTimeout(() => this.setupWebSocket(), 3000);
        };
        
        this.ws.onerror = () => {
            this.updateConnectionStatus('disconnected');
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
    }
    
    handleMessage(data) {
        switch (data.type) {
            case 'initial_data':
                this.greenhouses = data.greenhouses;
                this.greenhouseStatus = data.status;
                this.thresholds = data.thresholds;
                this.drawGreenhouses();
                this.updateStats();
                break;
            case 'sensor_update':
                this.greenhouseStatus[data.greenhouseId] = data.data;
                this.drawGreenhouses();
                this.updateStats();
                if (this.selectedGreenhouse === data.greenhouseId) {
                    this.updateDetailModal();
                }
                break;
        }
    }
    
    updateConnectionStatus(status) {
        const el = document.getElementById('connectionStatus');
        el.className = 'connection-status ' + status;
        el.textContent = status === 'connected' ? '✓ 已连接' : status === 'connecting' ? '连接中...' : '✗ 已断开';
    }
    
    updateTime() {
        const now = new Date();
        document.getElementById('timeDisplay').textContent = now.toLocaleString('zh-CN');
    }
    
    drawGreenhouses() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i < this.canvas.width; i += 30) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, this.canvas.height);
            ctx.stroke();
        }
        for (let i = 0; i < this.canvas.height; i += 30) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(this.canvas.width, i);
            ctx.stroke();
        }
        
        this.greenhouses.forEach(gh => {
            const status = this.greenhouseStatus[gh.id] || { scoreColor: '#666', score: 0 };
            
            ctx.fillStyle = status.scoreColor;
            ctx.globalAlpha = status.online === false ? 0.4 : 0.8;
            ctx.beginPath();
            ctx.roundRect(gh.x, gh.y, gh.width, gh.height, 5);
            ctx.fill();
            ctx.globalAlpha = 1;
            
            if (status.online === false) {
                ctx.strokeStyle = '#666';
                ctx.setLineDash([5, 3]);
            } else {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.setLineDash([]);
            }
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.setLineDash([]);
            
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(gh.id, gh.x + gh.width / 2, gh.y + gh.height / 2 - 3);
            
            ctx.font = '10px Arial';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fillText(gh.crop, gh.x + gh.width / 2, gh.y + gh.height / 2 + 10);
            
            if (status.online === false) {
                ctx.fillStyle = '#666';
                ctx.font = 'bold 9px Arial';
                ctx.fillText('离线', gh.x + gh.width / 2, gh.y + gh.height / 2 + 22);
            }
            
            const devices = status.devices || {};
            let deviceY = gh.y + gh.height + 8;
            if (devices.fan) {
                ctx.fillStyle = '#4CAF50';
                ctx.beginPath();
                ctx.arc(gh.x + 10, deviceY, 4, 0, Math.PI * 2);
                ctx.fill();
            }
            if (devices.spray) {
                ctx.fillStyle = '#4CAF50';
                ctx.beginPath();
                ctx.arc(gh.x + 22, deviceY, 4, 0, Math.PI * 2);
                ctx.fill();
            }
            if (devices.light) {
                ctx.fillStyle = '#FFC107';
                ctx.beginPath();
                ctx.arc(gh.x + 34, deviceY, 4, 0, Math.PI * 2);
                ctx.fill();
            }
            
            const alarms = status.alarms || {};
            if (alarms.highTemp || alarms.lowHumidity || alarms.highCO2) {
                ctx.fillStyle = '#F44336';
                ctx.font = 'bold 14px Arial';
                ctx.fillText('!', gh.x + gh.width - 8, gh.y + 15);
            }
        });
    }
    
    setupEventListeners() {
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleCanvasHover(e));
        this.canvas.addEventListener('mouseleave', () => this.hideTooltip());
        
        document.getElementById('closeModal').addEventListener('click', () => this.closeDetailModal());
        document.getElementById('closeCompareModal').addEventListener('click', () => this.closeCompareModal());
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentChartType = e.target.dataset.type;
                this.loadTrendData();
            });
        });
        
        document.getElementById('compareBtn').addEventListener('click', () => this.openCompareModal());
        document.getElementById('refreshBtn').addEventListener('click', () => location.reload());
        document.getElementById('startCompare').addEventListener('click', () => this.startCompare());
    }
    
    handleCanvasClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        for (const gh of this.greenhouses) {
            if (x >= gh.x && x <= gh.x + gh.width && y >= gh.y && y <= gh.y + gh.height) {
                if (this.compareMode) {
                    if (this.compareGreenhouses.length < 2 && !this.compareGreenhouses.indexOf(gh.id) === -1) {
                        this.compareGreenhouses.push(gh.id);
                        if (this.compareGreenhouses.length === 2) {
                            this.openCompareModal();
                            this.compareMode = false;
                        }
                    }
                } else {
                    this.selectedGreenhouse = gh.id;
                    this.openDetailModal(gh);
                }
                break;
            }
        }
    }
    
    handleCanvasHover(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        let hovered = null;
        for (const gh of this.greenhouses) {
            if (x >= gh.x && x <= gh.x + gh.width && y >= gh.y && y <= gh.y + gh.height) {
                hovered = gh;
                break;
            }
        }
        
        if (hovered) {
            this.showTooltip(e.clientX, e.clientY, hovered);
            this.canvas.style.cursor = 'pointer';
        } else {
            this.hideTooltip();
            this.canvas.style.cursor = 'default';
        }
    }
    
    createTooltip() {
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'tooltip';
        this.tooltip.style.display = 'none';
        document.body.appendChild(this.tooltip);
    }
    
    showTooltip(x, y, gh) {
        const status = this.greenhouseStatus[gh.id] || {};
        const growthStageNames = {
            seedling: '苗期',
            vegetative: '营养生长期',
            flowering: '开花期',
            fruiting: '结果期',
            maturity: '成熟期'
        };
        const weights = status.weights || {};
        this.tooltip.innerHTML = `
            <div class="tooltip-title">${gh.name} (${gh.id})</div>
            <div class="tooltip-item"><span>作物:</span><span>${gh.crop}</span></div>
            <div class="tooltip-item"><span>生长阶段:</span><span>${growthStageNames[gh.growthStage] || gh.growthStage || '-'}</span></div>
            <div class="tooltip-item"><span>在线状态:</span><span style="color:${status.online === false ? '#F44336' : '#4CAF50'}">${status.online === false ? '离线' : '在线'}</span></div>
            <div class="tooltip-item"><span>温度:</span><span>${status.temperature?.toFixed(1)}℃</span></div>
            <div class="tooltip-item"><span>湿度:</span><span>${status.humidity?.toFixed(1)}%</span></div>
            <div class="tooltip-item"><span>光照:</span><span>${status.light?.toFixed(0)}lux</span></div>
            <div class="tooltip-item"><span>CO2:</span><span>${status.co2?.toFixed(0)}ppm</span></div>
            <div class="tooltip-item"><span>土壤:</span><span>${status.soilMoisture?.toFixed(1)}%</span></div>
            <div class="tooltip-item"><span>综合评分:</span><span style="color:${status.scoreColor}">${status.score?.toFixed(1)}分</span></div>
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.2);font-size:11px;color:rgba(255,255,255,0.6)">
                权重配置: 温${(weights.temperature * 100).toFixed(0)}% / 湿${(weights.humidity * 100).toFixed(0)}% / 光${(weights.light * 100).toFixed(0)}%
            </div>
        `;
        this.tooltip.style.display = 'block';
        this.tooltip.style.left = (x + 15) + 'px';
        this.tooltip.style.top = (y + 15) + 'px';
    }
    
    hideTooltip() {
        this.tooltip.style.display = 'none';
    }
    
    async openDetailModal(gh) {
        const modal = document.getElementById('detailModal');
        document.getElementById('modalTitle').textContent = `${gh.name} (${gh.id}) - ${gh.crop}`;
        modal.classList.add('active');
        
        this.updateDetailModal();
        this.loadTrendData();
    }
    
    updateDetailModal() {
        const status = this.greenhouseStatus[this.selectedGreenhouse] || {};
        const gh = this.greenhouses.find(g => g.id === this.selectedGreenhouse);
        const growthStageNames = {
            seedling: '苗期',
            vegetative: '营养生长期',
            flowering: '开花期',
            fruiting: '结果期',
            maturity: '成熟期'
        };
        const weights = status.weights || {};
        
        document.getElementById('sensorData').innerHTML = `
            <div class="sensor-item">
                <span class="sensor-label">生长阶段</span>
                <span class="sensor-value" style="color:#9C27B0">${growthStageNames[gh?.growthStage] || gh?.growthStage || '-'}</span>
            </div>
            <div class="sensor-item">
                <span class="sensor-label">在线状态</span>
                <span class="sensor-value" style="color:${status.online === false ? '#F44336' : '#4CAF50'}">${status.online === false ? '离线' : '在线'}</span>
            </div>
            <div class="sensor-item">
                <span class="sensor-label">温度</span>
                <span class="sensor-value temperature">${status.temperature?.toFixed(1)}℃</span>
            </div>
            <div class="sensor-item">
                <span class="sensor-label">湿度</span>
                <span class="sensor-value humidity">${status.humidity?.toFixed(1)}%</span>
            </div>
            <div class="sensor-item">
                <span class="sensor-label">光照</span>
                <span class="sensor-value light">${status.light?.toFixed(0)}lux</span>
            </div>
            <div class="sensor-item">
                <span class="sensor-label">CO2</span>
                <span class="sensor-value co2">${status.co2?.toFixed(0)}ppm</span>
            </div>
            <div class="sensor-item">
                <span class="sensor-label">土壤含水率</span>
                <span class="sensor-value soilMoisture">${status.soilMoisture?.toFixed(1)}%</span>
            </div>
            <div class="sensor-item">
                <span class="sensor-label">综合评分</span>
                <span class="sensor-value score">${status.score?.toFixed(1)}分</span>
            </div>
            <div class="sensor-item" style="grid-column: span 2; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
                <span class="sensor-label">当前权重配置</span>
                <span class="sensor-value" style="font-size: 14px;">温${(weights.temperature * 100).toFixed(0)}% / 湿${(weights.humidity * 100).toFixed(0)}% / 光${(weights.light * 100).toFixed(0)}%</span>
            </div>
        `;
        
        const devices = status.devices || {};
        document.getElementById('deviceStatus').innerHTML = `
            <div class="device-item">
                <span class="device-name">🌬️ 风机</span>
                <span class="device-status-badge ${devices.fan ? 'on' : 'off'}">${devices.fan ? '运行中' : '已关闭'}</span>
            </div>
            <div class="device-item">
                <span class="device-name">💧 喷雾系统</span>
                <span class="device-status-badge ${devices.spray ? 'on' : 'off'}">${devices.spray ? '运行中' : '已关闭'}</span>
            </div>
            <div class="device-item">
                <span class="device-name">💡 补光灯</span>
                <span class="device-status-badge ${devices.light ? 'on' : 'off'}">${devices.light ? '运行中' : '已关闭'}</span>
            </div>
        `;
        
        document.getElementById('controlButtons').innerHTML = `
            <button class="control-btn ${devices.fan ? 'on' : 'off'}" onclick="app.toggleDevice('fan')">
                ${devices.fan ? '关闭风机' : '开启风机'}
            </button>
            <button class="control-btn ${devices.spray ? 'on' : 'off'}" onclick="app.toggleDevice('spray')">
                ${devices.spray ? '关闭喷雾' : '开启喷雾'}
            </button>
            <button class="control-btn ${devices.light ? 'on' : 'off'}" onclick="app.toggleDevice('light')">
                ${devices.light ? '关闭补光' : '开启补光'}
            </button>
        `;
    }
    
    async toggleDevice(device) {
        const status = this.greenhouseStatus[this.selectedGreenhouse];
        const currentState = status.devices?.[device];
        const action = currentState ? 'OFF' : 'ON';
        
        try {
            await fetch(`/api/greenhouses/${this.selectedGreenhouse}/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device, action, reason: '手动控制' })
            });
        } catch (error) {
            console.error('控制失败:', error);
        }
    }
    
    async loadTrendData() {
        try {
            const response = await fetch(`/api/greenhouses/${this.selectedGreenhouse}/data`);
            this.trendData = await response.json();
            this.drawTrendChart();
        } catch (error) {
            console.error('加载趋势数据失败:', error);
        }
    }
    
    drawTrendChart() {
        const ctx = this.trendChartCtx;
        const canvas = this.trendChartCanvas;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        if (this.trendData.length === 0) return;
        
        const padding = { top: 20, right: 20, bottom: 40, left: 60 };
        const chartWidth = canvas.width - padding.left - padding.right;
        const chartHeight = canvas.height - padding.top - padding.top - padding.bottom;
        
        const values = this.trendData.map(d => d[this.currentChartType]);
        const minVal = Math.min(...values) * 0.95;
        const maxVal = Math.max(...values) * 1.05;
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(canvas.width - padding.right, y);
            ctx.stroke();
            
            const value = maxVal - ((maxVal - minVal) * (i / 4));
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.font = '10px Arial';
            ctx.textAlign = 'right';
            ctx.fillText(value.toFixed(1), padding.left - 5, y + 4);
        }
        
        const colors = {
            temperature: '#FF6B6B',
            humidity: '#4ECDC4',
            light: '#FFE66D',
            co2: '#95E1D3',
            soilMoisture: '#74B9FF'
        };
        
        ctx.strokeStyle = colors[this.currentChartType] || '#4CAF50';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        this.trendData.forEach((d, i) => {
            const x = padding.left + (chartWidth / (this.trendData.length - 1)) * i;
            const y = padding.top + chartHeight - ((d[this.currentChartType] - minVal) / (maxVal - minVal)) * chartHeight;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        
        ctx.stroke();
        
        ctx.fillStyle = colors[this.currentChartType] || '#4CAF50';
        this.trendData.forEach((d, i) => {
            const x = padding.left + (chartWidth / (this.trendData.length - 1)) * i;
            const y = padding.top + chartHeight - ((d[this.currentChartType] - minVal) / (maxVal - minVal)) * chartHeight;
            
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        });
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        const labels = this.trendData.filter((_, i) => i % Math.ceil(this.trendData.length / 6) === 0);
        labels.forEach((d, i) => {
            const x = padding.left + (chartWidth / (this.trendData.length - 1) * i * Math.ceil(this.trendData.length / 6);
            const time = new Date(d._time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            ctx.fillText(time, x, canvas.height - 10);
        });
    }
    
    closeDetailModal() {
        document.getElementById('detailModal').classList.remove('active');
        this.selectedGreenhouse = null;
    }
    
    openCompareModal() {
        const modal = document.getElementById('compareModal');
        const select1 = document.getElementById('compareSelect1');
        const select2 = document.getElementById('compareSelect2');
        
        select1.innerHTML = this.greenhouses.map(gh => 
            `<option value="${gh.id}">${gh.name}</option>`
        ).join('');
        
        select2.innerHTML = this.greenhouses.map(gh => 
            `<option value="${gh.id}">${gh.name}</option>`
        ).join('');
        
        modal.classList.add('active');
    }
    
    closeCompareModal() {
        document.getElementById('compareModal').classList.remove('active');
        this.compareGreenhouses = [];
    }
    
    async startCompare() {
        const gh1 = document.getElementById('compareSelect1').value;
        const gh2 = document.getElementById('compareSelect2').value;
        
        try {
            const [data1, data2] = await Promise.all([
                fetch(`/api/greenhouses/${gh1}/data`).then(r => r.json()),
                fetch(`/api/greenhouses/${gh2}/data`).then(r => r.json())
            ]);
            
            this.drawCompareChart('compareTempChart', data1, data2, 'temperature', '#FF6B6B', '#4ECDC4');
            this.drawCompareChart('compareHumChart', data1, data2, 'humidity', '#4ECDC4', '#FFE66D');
        } catch (error) {
            console.error('对比数据加载失败:', error);
        }
    }
    
    drawCompareChart(canvasId, data1, data2, type, color1, color2) {
        const canvas = document.getElementById(canvasId);
        const ctx = canvas.getContext('2d');
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        if (data1.length === 0 && data2.length === 0) return;
        
        const padding = { top: 20, right: 20, bottom: 30, left: 50 };
        const chartWidth = canvas.width - padding.left - padding.right;
        const chartHeight = canvas.height - padding.top - padding.bottom;
        
        const allValues = [...data1.map(d => d[type]), ...data2.map(d => d[type])];
        const minVal = Math.min(...allValues) * 0.95;
        const maxVal = Math.max(...allValues) * 1.05;
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(canvas.width - padding.right, y);
            ctx.stroke();
        }
        
        this.drawCompareLine(ctx, data1, type, color1, padding, chartWidth, chartHeight, minVal, maxVal);
        this.drawCompareLine(ctx, data2, type, color2, padding, chartWidth, chartHeight, minVal, maxVal);
        
        ctx.fillStyle = color1;
        ctx.font = '10px Arial';
        ctx.fillText('大棚1', canvas.width - 80, 15);
        ctx.fillStyle = color2;
        ctx.fillText('大棚2', canvas.width - 80, 30);
    }
    
    drawCompareLine(ctx, data, type, color, padding, chartWidth, chartHeight, minVal, maxVal) {
        if (data.length === 0) return;
        
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        data.forEach((d, i) => {
            const x = padding.left + (chartWidth / (data.length - 1)) * i;
            const y = padding.top + chartHeight - ((d[type] - minVal) / (maxVal - minVal)) * chartHeight;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        
        ctx.stroke();
    }
    
    updateStats() {
        let normalCount = 0;
        let alarmCount = 0;
        let deviceRunning = 0;
        
        Object.values(this.greenhouseStatus).forEach(status => {
            if (status.score > 60) normalCount++;
            if (status.alarms?.highTemp || status.alarms?.lowHumidity || status.alarms?.highCO2) alarmCount++;
            if (status.devices?.fan) deviceRunning++;
            if (status.devices?.spray) deviceRunning++;
            if (status.devices?.light) deviceRunning++;
        });
        
        document.getElementById('normalCount').textContent = normalCount;
        document.getElementById('alarmCount').textContent = alarmCount;
        document.getElementById('deviceRunning').textContent = deviceRunning;
        document.getElementById('totalGreenhouses').textContent = this.greenhouses.length;
    }
}

const app = new GreenhouseSystem();
