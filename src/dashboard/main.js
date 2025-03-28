// 内置版本 v0.1.4

import express from 'express';
import { existsSync, mkdirSync, readFileSync, writeFile, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { deviceList, sleep, resetStatsDataTemp, addObjValueNumber, getNowStatsDataDate, deepMergeObject } from './util.js';
import { dash_logger } from '../logger.js';
import { config } from '../config.js';

const Config = {
	config: {},
	enableWebPanel: true,
	allowRobots: false,
	webNodeIdx: -1,
	webNodes: [],
	nodeIds: [],
};
(async () => {
	const addrFilePath = path.resolve('./data/dashboard/config.json');
	if(existsSync(addrFilePath)){
		const cfg = JSON.parse(readFileSync(addrFilePath, { encoding: 'utf8' }));

		Config.config = cfg;

		if(cfg.nodes){
			let idx = 0;
			for(const nodeId in cfg.nodes){
				const node = cfg.nodes[nodeId];

				if(nodeId === process.env.CLUSTER_ID){
					if(node.enable === false) Config.enableWebPanel = false;
					if(node.allowRobots === true) Config.allowRobots = true;
					Config.webNodeIdx = idx;
				}

				Config.webNodes.push({
					title: node.title,
					name: node.name,
				});
				Config.nodeIds.push(nodeId);
				idx++;
			}
		}
	}

	Config.config.dataPath ??= './data/dashboard';
})();

const statsDataTemp = {
	hits: 0,
	bytes: 0,
	device: {},
	network: {
		v4: 0,
		v6: 0,
		none: 0,
	},
};
for(const deviceName in deviceList){
	if(statsDataTemp.device[deviceName] === undefined){
		statsDataTemp.device[deviceName] = 0;
	}
}

let statsData;

// 滚动更新数据列表
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

const dataPath = path.resolve(Config.config.dataPath);
(async () => {

	// 创建数据目录
	if(!existsSync(dataPath)){
		mkdirSync(dataPath);
	}
	const statsFilePath = path.join(dataPath, `./stats_${process.env.CLUSTER_ID || 'default'}.json`);

	// 读取统计数据
	const readStatsFile = async () => {
		try{
			const data = await readFile(statsFilePath, { encoding: 'utf8' });
			statsData = JSON.parse(data);
		}catch(err){
			dash_logger.warn(`读取统计数据时出错`, err);
		}
	};
	
	// 初始化统计数据
	if(existsSync(statsFilePath)) await readStatsFile();

	statsData = deepMergeObject({
		date: 	getNowStatsDataDate(),
		hours:	Array.from({ length: 25 }, () => ({ hits: 0, bytes: 0 })),
		months:	Array.from({ length: 13 }, () => ({ hits: 0, bytes: 0 })),
		years:	Array.from({ length: 7 }, () => ({ hits: 0, bytes: 0 })),
		heatmap: Array.from({ length: 365 }, () => ([ 0, 0 ])),
		all:	structuredClone(statsDataTemp),
		_worker: {
			mainThread: 0,
			saveTime: 0,
			syncData: {},
		},
	}, statsData);

	// 数据结构更新
	(() => {
		// v0.0.9: 移除 statsData.days, 因为它与 heatmap 重叠
		if(statsData.days){
			delete statsData.days;
		}
		// v0.0.10: 修复 statsData.all.network 统计数据过大的问题
		if(statsData.all.network.v4 + statsData.all.network.v6 > statsData.all.hits){
			// 计算 v4 和 v6 的比率
			const v4Ratio = statsData.all.network.v4 / (statsData.all.network.v4 + statsData.all.network.v6);
			statsData.all.network.v4 = Math.floor(statsData.all.hits * v4Ratio);
			statsData.all.network.v6 = statsData.all.hits - statsData.all.network.v4;
		}
	})();

	scrollingUpdateStatsData(statsData);

	// 线程启动后将自己的时间戳写进 mainThread, 只有当时间戳相等才维护数据, 否则仅将新数据写入 syncData
	let ThreadModeMain = true;
	const ThreadTime = Date.now() + process.uptime() * 1000;
	statsData._worker.mainThread = ThreadTime;
	writeFileSync(statsFilePath, JSON.stringify(statsData));


	const startStatsDataSave = async () => {
		
		// 主要线程等待同步线程写入文件完毕后再运行保存
		if(ThreadModeMain) await sleep(500);

		await readStatsFile();
		
		scrollingUpdateStatsData(statsData);
		
		// 判断是否还是主线程
		if(statsData._worker.mainThread === ThreadTime){

			ThreadModeMain = true;
			// console.log(`[AplPanel] 保存统计数据`, new Date());

			// 收集同步线程的数据
			addObjValueNumber(statsDataTemp, statsData._worker.syncData);
			statsData._worker.syncData = {};

			// 保存数据到每个图表
			statsData.hours.at(-1).hits += statsDataTemp.hits;
			statsData.hours.at(-1).bytes += statsDataTemp.bytes;
	
			statsData.months.at(-1).hits += statsDataTemp.hits;
			statsData.months.at(-1).bytes += statsDataTemp.bytes;
	
			statsData.years.at(-1).hits += statsDataTemp.hits;
			statsData.years.at(-1).bytes += statsDataTemp.bytes;

			statsData.heatmap.at(-1)[0] += statsDataTemp.hits;
			statsData.heatmap.at(-1)[1] += statsDataTemp.bytes;

			addObjValueNumber(statsData.all, statsDataTemp);

		}else{

			if(ThreadModeMain) dash_logger.debug(`${ThreadTime} 将作为同步线程运行`);
			ThreadModeMain = false;
			// console.log(`[AplPanel] 同步统计数据`, new Date());

			// 仅同步
			addObjValueNumber(statsData._worker.syncData, statsDataTemp, true);
		}
		
		// 清空临时数据
		resetStatsDataTemp(statsDataTemp);

		statsData._worker.saveTime = Date.now();
	
		writeFile(statsFilePath, JSON.stringify(statsData), (err) => {
			if(err) dash_logger.error(`保存统计数据失败`, err);
		});
		
		// [可爱的定时器] 计算到下一个每分钟过2秒的时间, 设置定时器
		const nextTime = new Date();
		nextTime.setMinutes(nextTime.getMinutes() + (nextTime.getSeconds() >= 1 ? 1 : 0));
		nextTime.setSeconds(1);
		setTimeout(async () => {
			startStatsDataSave();
		}, nextTime.getTime() - Date.now());
	};

	// 等待 30 秒后启动数据保存
	setTimeout(() => {
		startStatsDataSave();
	}, 30 * 1000);

	// 等待 4 秒后再判断是否是主线程
	setTimeout(async () => {
		await readStatsFile();
		if(statsData._worker.mainThread !== ThreadTime){
			if(ThreadModeMain) dash_logger.debug(`${ThreadTime} 将作为同步线程运行`);
			ThreadModeMain = false;
		}
	}, 4 * 1000);

	dash_logger.debug(`${ThreadTime} 已启动`);
})();



// 添加导入 `import { aplPanelListener, aplPanelServe } from '../aplPanel/main.js';`

/**
 * 添加到代码之后 cluster.js, `const { bytes, hits } = await this.storage.express(hashPath, req, res, next);`
 *   - `aplPanelListener(req, bytes, hits);`
 * @param {import('express').Request} req
 * @param {number} bytes - 这个文件的大小
 * @param {number} hits - 命中次数 / 是否命中
 */
export const aplPanelListener = async (req, bytes, hits) => {
	try{
		statsDataTemp.hits += hits;
		statsDataTemp.bytes += bytes;

		const userAgent = req.headers['user-agent'] || '[Unknown]';
		const deviceType = userAgent.slice(0, userAgent.indexOf('/'));
		if(deviceList[deviceType]){
			statsDataTemp.device[deviceType] ++;
		}else{
			statsDataTemp.device['[Other]'] ++;
		}

		const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip;
		if(!ip){
			statsDataTemp.network.none ++;
			return;
		}

		if(`${ip}`.indexOf('.')){
			statsDataTemp.network.v4 ++;
		}else{
			statsDataTemp.network.v6 ++;
		}
		
	} catch(err) {
		dash_logger.error(err);
	}
};

/**
 * 添加到代码之前 cluster.js, `app.get('/download/:hash(\\w+)', async (req, res, next) => {`
 *   - `aplPanelServe(app);`
 * @param {import('express').Application} _app
 * @param {Object} _storage
 */
export const aplPanelServe = (_app, _storage) => {
	dash_logger.info(`正在启动面板服务`);
	if(Config.allowRobots){
		_app.get('/robots.txt', (req, res) => {
			res.type('text/plain');
			res.send('User-agent: *\nAllow: /dashboard');
		});
	}

	_app.use('/', express.static(path.resolve('./dist/dashboard/public'), {
		setHeaders: (res, urlPath) => {
			// 指示浏览器缓存静态文件
			if(urlPath.endsWith('.html')){
				res.setHeader('Cache-Control', 'no-cache');
			}else{
				res.setHeader('Cache-Control', 'public, max-age=31536000');
			}
		}
	}));

	// 将涉及磁盘操作的数据缓存几秒
	let nodeDataCache = {};
	let nodeDataCache_all = null;

	// 自动清理缓存
	const clearNodeDataCache = () => {
		const nextTime = new Date();
		nextTime.setMinutes(nextTime.getMinutes() + (nextTime.getSeconds() >= 2 ? 1 : 0));
		nextTime.setSeconds(2);
		setTimeout(() => {
			nodeDataCache = {};
			nodeDataCache_all = null;
			clearNodeDataCache();
		}, nextTime.getTime() - Date.now());
	};
	clearNodeDataCache();

	// 为web提供节点版本
	_app.get('/dashboard/api/version', async (req, res) => {
		res.json({
			version: config.version,
			protocol_version: config.protocol_version,
		});
	});

	_app.get('/dashboard/api/stats', async (req, res, next) => {

		// ./api/stats?idx=
		const inp = {
			idx: Number(req.query?.idx ?? Config.webNodeIdx),
		};

		/**
		 * 获取一个本地或远程节点的数据
		 * @param {String} nodeId - 节点id
		 */
		const getNodeStatsData = async (nodeId) => {
			try{
				const url = Config.config.nodes[nodeId]?.url;
				if(url){
					const res = await fetch(`${url.replace(/\/$/, '')}/dashboard/api/stats?idx=-1`);
					const data = await res.json();
					return data.statsData;
				}else{
					return JSON.parse(await readFile(path.join(dataPath, `./stats_${nodeId}.json`), { encoding: 'utf8' }));
				}
			}catch(err){
				dash_logger.error(`读取其他节点统计数据时出错 [${nodeId}]:`, err);
				return null;
			}
		};

		if(inp.idx !== Config.webNodeIdx && Config.nodeIds[inp.idx]){
			// 提供其他节点的数据
			try{

				// 提供所有节点的数据
				if(Config.nodeIds[inp.idx] === '_ALL_'){
					// 读取所有节点的信息
					for(let idx = 0; idx < Config.nodeIds.length; idx++){
						if(nodeDataCache[idx]){
							continue;
						}
						if(idx === Config.webNodeIdx){
							continue;
						}
						const nodeId = Config.nodeIds[idx];
						if(nodeId.length !== 24){
							continue;
						}
						const sd = await getNodeStatsData(nodeId);
						if(!sd){
							continue;
						}
						nodeDataCache[idx] = sd;
						scrollingUpdateStatsData(nodeDataCache[idx]);
					}
					// 合并数据
					if(nodeDataCache_all === null){
						nodeDataCache_all = structuredClone(statsData);
						for(const nodeDataIdx in nodeDataCache){
							addObjValueNumber(nodeDataCache_all.hours, nodeDataCache[nodeDataIdx].hours);
							addObjValueNumber(nodeDataCache_all.months, nodeDataCache[nodeDataIdx].months);
							addObjValueNumber(nodeDataCache_all.years, nodeDataCache[nodeDataIdx].years);
							addObjValueNumber(nodeDataCache_all.heatmap, nodeDataCache[nodeDataIdx].heatmap);
							addObjValueNumber(nodeDataCache_all.all, nodeDataCache[nodeDataIdx].all);
						}
					}
					res.json({
						statsData: nodeDataCache_all,
						webNodes: Config.webNodes,
						webNodeIdx: inp.idx,
					});
					return;
				}

				// 提供其他节点的数据
				if(!nodeDataCache[inp.idx]){
					const sd = await getNodeStatsData(Config.nodeIds[inp.idx]);
					if(!sd){
						res.json(null);
						return;
					}
					nodeDataCache[inp.idx] = sd;
					scrollingUpdateStatsData(nodeDataCache[inp.idx]);
				}
				res.json({
					statsData: nodeDataCache[inp.idx],
					webNodes: Config.webNodes,
					webNodeIdx: inp.idx,
				});
			}catch(err){
				dash_logger.error(`处理其他节点统计数据时出错`, err);
				res.json(null);
			}
		}else{
			// 提供当前节点的数据
			res.json({
				statsData: statsData,
				statsDataTemp: statsDataTemp,
				webNodes: Config.webNodes,
				webNodeIdx: Config.webNodeIdx,
			});
		}
	});
};

