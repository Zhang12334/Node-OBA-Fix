

/**
 * 简单的深度合并对象
 * @param {Object} target
 * @param {Object} source
 * @returns Object - 合并后的对象
 */
export const deepMergeObject = (target, source = {}) => {

	const result = {};

	for(const key in target){
		if(target.hasOwnProperty(key)){
			result[key] = target[key];
		}
	}
	
	for(const key in source){
		if(source.hasOwnProperty(key)){
			if(source[key] !== null && source[key].constructor === Object){
				result[key] = deepMergeObject(result[key], source[key]);
			}else{
				result[key] = source[key];
			}
		}
	}
	return result;
};

// 获取从 1970-01-01 00:00:00 UTC 到现在的 小时, 天, 月, 年 数量
export const getNowStatsDataDate = () => {
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
 * 相加两个对象的数值, 如果没有则创建
 * @param {Object} obj1 - 合并到对象
 * @param {Object} obj2 - 要合并的数据
 * @param {Boolean} ueeObj2 - 遍历 obj2 的数据, 默认只合并 obj1 中存在的数据
 */
export const addObjValueNumber = (obj1, obj2, ueeObj2 = false) => {
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

// 重置对象中所有数值为 0
export const resetStatsDataTemp = (obj) => {
	for(const key in obj){
		if(obj[key].constructor === Object){
			resetStatsDataTemp(obj[key]);
		}else if(obj[key].constructor === Number){
			obj[key] = 0;
		}
	}
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const deviceList = {
	'[Unknown]': true,	// 无 UA 设备
	'[Other]': true,	// 列表之外的设备

	'BakaXL': true,
	'Bun': true,
	'Dalvik': true,
	'FCL': true,
	'FileDownloader': true,
	'Gradle': true,
	'HMCL': true,
	'HMCL-PE': true,
	'Java': true,
	'Java-http-client': true,
	'LauncherX': true,
	'MCinaBox': true,
	'MSLTeam-MSL': true,
	'MinecraftLaunch': true,
	'MinecraftLauncher': true,
	'Mozilla': true,
	'Natsurainko.FluentLauncher': true,
	'PCL2': true,
	'PZH': true,
	'Pojav': true,
	'PojavLauncher': true,
	'Python': true,
	'Python-urllib': true,
	'SharpCraftLauncher': true,
	'VQRL': true,
	'ZalithLauncher': true,
	'bmclapi-ctrl': true,
	'bmclapi-warden': true,
	'meta-externalagent': true,
	'openbmclapi-cluster': true,
	'python-requests': true,
	'voxelum': true
};
