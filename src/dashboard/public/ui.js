
const lib = {

	numberFormat: (value, retainDecimals = 0) => {
		const unit = ['', 'K', 'M', 'B', 'T', 'Q', 'Y'];
		let index = 0;
		while(value >= 1000){
			value /= 1000;
			index++;
		}
		if(unit[index] === '') retainDecimals = 0;
		return `${value.toFixed(retainDecimals)}${unit[index]}`;
	},

	trafficFormat: (value, retainDecimals = 0) => {
		const unit = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
		let index = 0;
		while(value >= 1024){
			value /= 1024;
			index++;
		}
		if(unit[index] === 'B') retainDecimals = 0;
		return `${value.toFixed(retainDecimals)}${unit[index]}`;
	},

	thousandSeparator: (value) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','),

	createElement: (tagName, data = null, options = {}) => {
		const el = document.createElement(tagName, options);
		if(data === null) return el;
		for(const key in data){
			el[key] = data[key];
		}
		return el;
	},
};

const loadLineChart = (el, data = {}, _data = {}) => {

	let throttle = false;
	const ro = new ResizeObserver((entries) => {
		if(throttle) return;
		throttle = true;
		setTimeout(() => {
			throttle = false;
			thisChart?.resize();
		}, 200);
	});
	ro.observe(el);

	const thisChart = echarts.init(el);
	thisChart.setOption(Object.assign({
		grid: {
			top: 30,
			left: 55,
			right: 55,
			bottom: 30,
		},
		xAxis: {
			type: 'category',
			data: [],
		},
		yAxis: [
			{
				type: 'value',
				alignTicks: true,
				axisLabel: {
					formatter: (value) => lib.numberFormat(value),
				},
				splitLine: {
					show: true,
					lineStyle: {
						color: '#7F7F7F80',
						type: 'solid',
						width: 1
					},
				},
			},
			{
				type: 'value',
				alignTicks: true,
				axisLabel: {
					formatter: (value) => lib.trafficFormat(value),
				},
				splitLine: {
					show: false,
					lineStyle: {
						color: '#7F7F7F80',
						type: 'solid',
						width: 1
					},
				},
			},
		],
		series: [
			{
				data: [],
				type: 'line',
				itemStyle: {
					color: '#06b0ff',
					width: 2,
				}
			}
		],
		tooltip: { // 鼠标悬停时显示数据框
			trigger: 'axis',
			// valueFormatter: (value, a) => {
			// 	console.log(value, a);
			// 	return lib.numberFormat(value);
			// },
			formatter: (params) => {
				return `
					<div style="font-size:14px;color:#666;font-weight:400;line-height:1; min-width: 100px;">${params[0].name}</div>
					<div style="margin: 10px 0 0;line-height:1;">
						${params[0].marker}
						<span style="font-size:14px;color:#666;font-weight:400;margin-left:2px">${params[0].seriesName}</span>
						<span style="float:right;margin-left:20px;font-size:14px;color:#666;font-weight:900">${lib.numberFormat(params[0].value, 2)}</span>
					</div>
					<div style="margin: 10px 0 0;line-height:1;">
						${params[1].marker}
						<span style="font-size:14px;color:#666;font-weight:400;margin-left:2px">${params[1].seriesName}</span>
						<span style="float:right;margin-left:20px;font-size:14px;color:#666;font-weight:900">${lib.trafficFormat(params[1].value, 2)}</span>
					</div>
				`;
			},
			axisPointer: {
				type: 'cross', // 显示十字架指示
				label: {
					formatter: (data) => {
						if(typeof data.value === 'number'){
							if(data.axisIndex === 0){
								return `${lib.numberFormat(data.value, 2)}`;
							}else if(data.axisIndex === 1){
								return `${lib.trafficFormat(data.value, 2)}`;
							}
						}
						return data.value;
					},
				},
			},
		},
	}, data));
};

const loadPieChart = (el, data = {}, _data = {}) => {

	let throttle = false;
	const ro = new ResizeObserver((entries) => {
		if(throttle) return;
		throttle = true;
		setTimeout(() => {
			throttle = false;
			thisChart?.resize();
		}, 200);
	});
	ro.observe(el);

	const thisChart = echarts.init(el);
	thisChart.setOption(Object.assign({
		series: [
			{
				name: 'Nightingale Chart',
				type: 'pie',
				radius: [20, 70],
				center: ['50%', '50%'],
				roseType: 'area',
				itemStyle: {
					borderRadius: 8
				},
				data: [],
			},
		],
		tooltip: {
			trigger: 'item',
			borderWidth: 0,
			formatter: (params) => {
				return `
					<div style="line-height:1;">
						${params.marker}
						<span style="font-size:14px;color:#666;font-weight:400;margin-left:2px">${params.name}</span>
						<span style="float:right;margin-left:20px;font-size:14px;color:#666;font-weight:900">${lib.numberFormat(params.value, 2)}</span>
					</div>
				`;
			},
		},
	}, data));
};

const loadBarChart = (el, data = {}, _data = {}) => {

	let throttle = false;
	const ro = new ResizeObserver((entries) => {
		if(throttle) return;
		throttle = true;
		setTimeout(() => {
			throttle = false;
			thisChart?.resize();
		}, 200);
	});
	ro.observe(el);

	const thisChart = echarts.init(el);
	thisChart.setOption(Object.assign({
		grid: {
			top: 30,
			left: 55,
			right: 25,
			bottom: 30,
		},
		tooltip: {
			trigger: 'axis',
			formatter: (params) => {
				return `
					<div style="line-height:1;">
						${params[0].marker}
						<span style="font-size:14px;color:#666;font-weight:400;margin-left:2px">${params[0].name}</span>
						<span style="float:right;margin-left:20px;font-size:14px;color:#666;font-weight:900">${lib.numberFormat(params[0].value, 2)}</span>
					</div>
				`;
			},
			axisPointer: {
				type: 'cross', // 显示十字架指示
				label: {
					formatter: (data) => {
						if(typeof data.value === 'number'){
							return `${lib.numberFormat(data.value, 2)}`;
						}
						return data.value;
					},
				},
			},
		},
		xAxis: {
			type: 'value',
			axisLabel: {
				formatter: (value) => lib.numberFormat(value),
			},
			splitLine: {
				show: true,
				lineStyle: {
					color: '#7F7F7F80',
					type: 'solid',
					width: 1
				},
			},
			// max: (value) => Math.max(...Object.values(value)) * 1.1,
		},
		yAxis: {
			data: ['IPv4', 'IPv6'],
		},
		series: [
			{
				type: 'bar',
				data: [100, 200]
			}
		]
	}, data));
};

/**
 * 相加两个对象的数值, 如果没有则创建
 * @param {Object} obj1 - 合并到对象
 * @param {Object} obj2 - 要合并的数据
 * @param {Boolean} ueeObj2 - 遍历 obj2 的数据, 默认只合并 obj1 中存在的数据
 */
const addObjValueNumber = (obj1, obj2, ueeObj2 = false) => {
	const reference = ueeObj2 ? obj2 : obj1;
	for(const key in reference){

		// 仅当遍历 obj1 时检查 obj2 中是否存在. 因为 obj1 可以添加 key
		if(ueeObj2 === false && obj2[key] === undefined){
			continue;
		}

		const constructor = reference[key].constructor;
		if(constructor === Number){
			if(obj1[key] === undefined) obj1[key] = 0;
			obj1[key] += obj2[key];
			continue;
		}
		if(constructor === Object){
			if(obj1[key] === undefined) obj1[key] = {};
			addObjValueNumber(obj1[key], obj2[key], ueeObj2);
			continue;
		}
		if(constructor === Array){
			if(obj1[key] === undefined) obj1[key] = [];
			for(let i = 0; i < obj2[key].length; i++){
				if(reference[key][i].constructor === Number){
					if(obj1[key][i] === undefined){
						obj1[key][i] = 0;
					}
					obj1[key][i] += obj2[key][i];
				}else{
					addObjValueNumber(obj1[key], obj2[key], ueeObj2);
				}
			}
		}
	}
};

// 获取从 1970-01-01 00:00:00 UTC 到现在的 小时, 天, 月, 年 数量
const getNowStatsDataDate = () => {
	const date = new Date();
	date.setHours(date.getHours() + 8);
	const hour = date.getTime() / (60 * 60 * 1000);
	return {
		hour: Math.floor(hour),
		day: Math.floor(hour / 24),
		month: Math.floor(hour / (30 * 24)),
		year: Math.floor(hour / (365 * 24)),
	};
};

/**
 * 滚动更新数据列表
 * @param {statsData} sd - statsData
 */
const scrollingUpdateStatsData = (sd) => {
	const nowDate = getNowStatsDataDate();
	const yearDiff = nowDate.year - sd.date.year;
	if(yearDiff > 0){
		sd.years.splice(0, yearDiff);
		sd.years.push(...Array.from({ length: Math.min(yearDiff, 7) }, () => ({ hits: 0, bytes: 0 })));
		sd.date.year += yearDiff;
	}
	const monthDiff = nowDate.month - sd.date.month;
	if(monthDiff > 0){
		sd.months.splice(0, monthDiff);
		sd.months.push(...Array.from({ length: Math.min(monthDiff, 13) }, () => ({ hits: 0, bytes: 0 })));
		sd.date.month += yearDiff;
	}
	const dayDiff = nowDate.day - sd.date.day;
	if(dayDiff > 0){
		sd.heatmap.splice(0, dayDiff);
		sd.heatmap.push(...Array.from({ length: Math.min(dayDiff, 365) }, () => ([ 0, 0 ])));
		sd.date.day += yearDiff;
	}
	const hourDiff = nowDate.hour - sd.date.hour;
	if(hourDiff > 0){
		sd.hours.splice(0, hourDiff);
		sd.hours.push(...Array.from({ length: Math.min(hourDiff, 25) }, () => ({ hits: 0, bytes: 0 })));
		sd.date.hour += yearDiff;
	}

	sd.date = nowDate;
};

let statsData = null;

queueMicrotask(() => {
	const statsRunTime = document.querySelector('.statsInfo .statsRunTime');
	const footerRunTime = document.querySelector('.dashboard-footer .footerRunTime');
	setInterval(() => {
		if(statsData !== null){

			const diff = Math.abs(Date.now() - statsData._worker.mainThread);
			const totalSeconds = Math.floor(diff / 1000);
			// 计算天时分秒
			const days = Math.floor(totalSeconds / (3600 * 24));
			const remainingSeconds = totalSeconds % (3600 * 24);
			const hours = Math.floor(remainingSeconds / 3600);
			const minutes = Math.floor((remainingSeconds % 3600) / 60);
			const seconds = remainingSeconds % 60;
			const parts = [];
			if(days > 0)	parts.push(`${days}天`);
			if(hours > 0)	parts.push(`${`${hours}`.padStart(2, '0')}时`);
			parts.push(`${`${minutes}`.padStart(2, '0')}分`);
			parts.push(`${`${seconds}`.padStart(2, '0')}秒`);

			statsRunTime.textContent = parts.join('');
			footerRunTime.textContent = parts.join('');
		}
	}, 1000);
});

const ui = {
	loadStatsDataTimeout: null,
};

// 获取页脚版本号显示元素
const footerVersion = document.querySelector('.dashboard-footer .footerVersion');
// 标记是否已成功获取过版本号
let isVersionFetched = false;

async function fetchVersion() {
  // 如果已经获取过版本号，则不再请求
  if (isVersionFetched) return;

  try {
    // 请求版本号API
    const response = await fetch('/dashboard/api/version');
    const data = await response.json();
    
    // 如果页脚元素存在，则更新显示
    if (footerVersion) {
      footerVersion.textContent = `v${data.version}`;
      // 标记已成功获取版本号
      isVersionFetched = true;
    }
  } catch (error) {
    console.error('获取版本号失败:', error);
    // 仅当从未设置过版本号时才显示默认值
    if (footerVersion && !footerVersion.textContent) {
      footerVersion.textContent = 'v0.0.1';
    }
  }
}

const loadStatsData = async () => {

	fetchVersion();

	if(ui.loadStatsDataTimeout) clearInterval(ui.loadStatsDataTimeout);
	
	let data = null;
	try{
		const response = await fetch(`./dashboard/api/stats`);
		data = await response.json();
	}catch(err){
		console.warn(`[loadStatsData] 获取数据失败:`, err);
	}
	
	ui.loadStatsDataTimeout = setTimeout(() => {
		loadStatsData();
	}, 7 * 1000);

	if(!data){
		console.log(`[loadStatsData] data 为空`);
		return;
	}

	statsData = data.statsData;

	// 由前端合并统计数据后显示, 逻辑与后端一致
	(() => { // ../main.js // 保存数据到每个图表
		if(!data.statsDataTemp) return;

		const statsDataTemp = data.statsDataTemp;

		addObjValueNumber(statsDataTemp, statsData._worker.syncData);

		statsData.hours.at(-1).bytes += statsDataTemp.bytes;
		statsData.hours.at(-1).hits += statsDataTemp.hits;

		// statsData.days.at(-1).bytes += statsDataTemp.bytes;
		// statsData.days.at(-1).hits += statsDataTemp.hits;

		statsData.months.at(-1).bytes += statsDataTemp.bytes;
		statsData.months.at(-1).hits += statsDataTemp.hits;

		statsData.years.at(-1).bytes += statsDataTemp.bytes;
		statsData.years.at(-1).hits += statsDataTemp.hits;

		statsData.heatmap.at(-1)[0] += statsDataTemp.hits;
		statsData.heatmap.at(-1)[1] += statsDataTemp.bytes;

		addObjValueNumber(statsData.all, statsDataTemp, true);
	})();

	// 统计信息
	(() => {
		const statsInfo = document.querySelector('.statsInfo');

		const hits = statsInfo.querySelector('.statsTotal');
		hits.textContent = lib.numberFormat(statsData.all.hits, 2);
		hits.dataset.title = lib.thousandSeparator(statsData.all.hits);

		const bytes = statsInfo.querySelector('.statsTotalTraffic');
		bytes.textContent = lib.trafficFormat(statsData.all.bytes, 2);
		bytes.dataset.title = lib.thousandSeparator(statsData.all.bytes);
	})();


	await new Promise(async (resolve, reject) => {
		// 获取保存时间, 每次循环减去一小时
		let time = new Date(statsData._worker.saveTime);

		const xAxisData = [];
		const hitsData = [];
		const bytesData = [];

		for(const hourData of statsData.hours){
			xAxisData.unshift(`${time.getHours()}时`);
			hitsData.push(hourData.hits);
			bytesData.push(hourData.bytes);
			time.setHours(time.getHours() - 1);
		}

		await loadLineChart(document.getElementById('chart_stats_rv_hour'), {
			xAxis: {
				data: xAxisData,
			},
			series: [
				{
					data: hitsData,
					yAxisIndex: 0,
					type: 'line',
					name: '请求',
					itemStyle: {
						color: '#10b981',
						width: 2,
					},
					markArea: {
						itemStyle: {
							color: '#20ff021c'
						},
						data: [
							[
								{
									xAxis: xAxisData.at(-2),
								},
								{
									xAxis: xAxisData.at(-1),
								}
							]
						]
					},
				},
				{
					data: bytesData,
					yAxisIndex: 1,
					type: 'line',
					name: '流量',
					itemStyle: {
						color: '#06b0ff',
						width: 2,
					},
				},
			],
		}, bytesData);

		resolve();
	});

	await new Promise(async (resolve, reject) => {
		// 获取保存时间, 每次循环减去一天
		let time = new Date(statsData._worker.saveTime);

		const xAxisData = [];
		const hitsData = [];
		const bytesData = [];

		for(const li of statsData.heatmap.slice(-31)){
			xAxisData.unshift(`${time.getMonth() + 1}-${time.getDate()}`);
			hitsData.push(li[0]);
			bytesData.push(li[1]);
			time.setDate(time.getDate() - 1);
		}

		await loadLineChart(document.getElementById('chart_stats_rv_day'), {
			xAxis: {
				data: xAxisData,
			},
			series: [
				{
					data: hitsData,
					yAxisIndex: 0,
					type: 'line',
					name: '请求',
					itemStyle: {
						color: '#10b981',
						width: 2,
					}
				},
				{
					data: bytesData,
					yAxisIndex: 1,
					type: 'line',
					name: '流量',
					itemStyle: {
						color: '#06b0ff',
						width: 2,
					}
				},
			],
		}, bytesData);

		resolve();
	});

	await new Promise(async (resolve, reject) => {
		// 获取保存时间, 每次循环减去一个月
		let time = new Date(statsData._worker.saveTime);

		const xAxisData = [];
		const hitsData = [];
		const bytesData = [];

		for(const monthData of statsData.months){
			xAxisData.unshift(`${time.getFullYear()}-${time.getMonth() + 1}`);
			hitsData.push(monthData.hits);
			bytesData.push(monthData.bytes);
			time.setMonth(time.getMonth() - 1);
		}

		await loadLineChart(document.getElementById('chart_stats_rv_month'), {
			xAxis: {
				data: xAxisData,
			},
			series: [
				{
					data: hitsData,
					yAxisIndex: 0,
					type: 'line',
					name: '请求',
					itemStyle: {
						color: '#10b981',
						width: 2,
					}
				},
				{
					data: bytesData,
					yAxisIndex: 1,
					type: 'line',
					name: '流量',
					itemStyle: {
						color: '#06b0ff',
						width: 2,
					}
				},
			],
		}, bytesData);

		resolve();
	});

	// 目前不考虑年

	new Promise(async (resolve, reject) => {

		let hitsMin = 0;
		let hitsMax = 0;
		// let bytesMin = 0;
		// let bytesMax = 0;
		for(const li of statsData.heatmap){
			hitsMin = Math.min(hitsMin, li[0]);
			hitsMax = Math.max(hitsMax, li[0]);
			// bytesMin = Math.min(bytesMin, li[1]);
			// bytesMax = Math.max(bytesMax, li[1]);
		}
		const allocate = (value, min, max) => Math.min(Math.max(value !== 0 ? 1 : 0, Math.round((value - min) / (max - min) * 4)), 4);

		const oneYearAgo = new Date();
		oneYearAgo.setDate(oneYearAgo.getDate() - 365);
		// 从两端补齐到一年 + 一周的时间
		const data = [ ...Array.from({ length: oneYearAgo.getDay() }, () => null), ...statsData.heatmap, ...Array.from({ length: 6 - oneYearAgo.getDay() }, () => null) ];

		const heatmap = document.getElementById('chart_stats_rv_heatmap').querySelector('& > .heatmap') || (() => {
			const root = document.getElementById('chart_stats_rv_heatmap');

			const heatmap = lib.createElement('div', {
				className: `heatmap`,
				___lastData: Array.from({ length: data.length }, () => null),
			});

			const floating = lib.createElement('div', {
				className: 'floating',
			});

			for(let i = 0; i < data.length; i++){
				const li = lib.createElement('div', {
					className: `null`,
				})
				li.addEventListener('mouseover', (event) => {
					if(event.target.classList.contains('null')) return;
					floating.classList.add('--join');
					floating.style.top = `${event.target.offsetTop}px`;
					floating.style.left = `${event.target.offsetLeft}px`;
					floating.textContent = event.target.dataset.title;

					const animationProcessing = () => {
						const pos1 = floating.offsetLeft - (floating.offsetWidth + 10);
						if(pos1 < 0){
							floating.style.transform = `translate(calc(-50% - ${pos1 / 2}px), -34px)`;
						}
						const pos2 = (window.innerWidth - root.scrollLeft) - (floating.offsetLeft + (floating.offsetWidth + 10));
						if(pos2 < 0){
							floating.style.transform = `translate(calc(-50% + ${pos2 / 2}px), -34px)`;
						}

						const offsetLeft = floating.offsetLeft;
						setTimeout(() => {
							if(floating.offsetLeft !== offsetLeft){
								animationProcessing();
							}
						}, 50);
					};
					animationProcessing();
					
				});
				li.addEventListener('mouseout', (event) => {
					floating.classList.remove('--join');
				});
				heatmap.appendChild(li);
			}

			root.appendChild(heatmap);
			root.appendChild(floating);
			return heatmap;
		})();

		// 使用服务器的时间来计算数据
		const time = new Date(statsData._worker.saveTime);
		let dayStep = 0;
		for(let i = data.length - 1; i >= 0; i--){

			// 当新数据与旧数据存在差异时更新元素
			if(heatmap.___lastData[i] === null || heatmap.___lastData[i][0] !== data[i][0] || heatmap.___lastData[i][1] !== data[i][1]){
				if(data[i] === null) continue;
				time.setDate(time.getDate() - dayStep);
				dayStep = 0;

				const day = heatmap.children[i];
				day.className = `lv-${allocate(data[i][0], hitsMin, hitsMax)}`;
				const textList = [
					`${time.getFullYear()}-${`${time.getMonth() + 1}`.padStart(2, '0')}-${`${time.getDate()}`.padStart(2, '0')} - `,
					`请求: ${lib.numberFormat(data[i][0], 2)}, `,
					`流量: ${lib.trafficFormat(data[i][1], 2)}`
				];
				day.dataset.title = textList.join('');
			}

			dayStep ++;
		}

		heatmap.___lastData = data;

		resolve();
	});

	await new Promise(async (resolve, reject) => {

		const pieData = [];

		for(const deviceName in statsData.all.device){
			pieData.push({
				value: statsData.all.device[deviceName],
				name: deviceName,
			});
		}

		// 取数值最大的前10个, 过滤 0 值
		const top10 = pieData.filter(i => i.value > 0).sort((a, b) => b.value - a.value).slice(0, 10);

		loadPieChart(document.getElementById('chart_stats_device'), {
			series: [
				{
					// name: '常见用户代理',
					type: 'pie',
					radius: [20, 70],
					center: ['50%', '50%'],
					roseType: 'area',
					itemStyle: {
						borderRadius: 8
					},
					data: top10,
					label: {
						color: '#7f7f7fb5'
					},
				},
			]
		})

		resolve();
	});

	await new Promise(async (resolve, reject) => {

		loadBarChart(document.getElementById('chart_stats_network_type'), {
			series: [
				{
					type: 'bar',
					data: [
						{
							value: statsData.all.network.v4,
							itemStyle: {
								color: '#06B0FF'
							}
						},
						{
							value: statsData.all.network.v6,
							itemStyle: {
								color: '#ff8c00'
							}
						}
					],
				}
			]
		})

		resolve();
	});

};
loadStatsData();

