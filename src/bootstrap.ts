import nodeCluster from 'cluster';
import colors from 'colors/safe.js';
import { HTTPError } from 'got';
import { max } from 'lodash-es';
import ms from 'ms';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Cluster } from './cluster.js';
import { config } from './config.js';
import {logger, sync_logger} from './logger.js'
import { TokenManager } from './token.js';
import { IFileList } from './types.js';
import got from 'got';
import fs from 'fs-extra';
import { notify } from './notify.js';

const davStorageUrl = config.storageOpts ? JSON.parse(JSON.stringify(config.storageOpts)) : {};
const davBaseUrl = `${davStorageUrl.url}/${davStorageUrl.basePath}`;
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const storageType = config.storage || 'file'; // 检查存储类型
const startuplimit = config.StartUPLimit || 90;
const STARTUP_LIMIT_WAIT_TIMEOUT = config.StartUPLimitWaitTimeout || 600;
const syncInterval = config.SyncInterval || '10m';

// 检查上线次数是否超过限制
function isExceedLimit(startupTimes: number[], limit: number): boolean {
  return startupTimes.length > limit;
}

// 删除超过 24 小时的上线记录
function filterRecentStartupTimes(startupTimes: number[]): number[] {
  const now = Date.now();
  const twentyFourHoursInMs = 24 * 60 * 60 * 1000;
  return startupTimes.filter((timestamp) => now - timestamp <= twentyFourHoursInMs);
}

// 检查文件是否已存在
async function checkFileExists(url: string): Promise<boolean> {
  try {
    await got.head(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${davStorageUrl.username}:${davStorageUrl.password}`).toString('base64')}`
      },
      https: { rejectUnauthorized: false }
    });
    return true; // 文件存在
  } catch (error: any) {
    if (error.response?.statusCode === 404) {
      return false; // 文件不存在
    }
    throw error; // 其他错误
  }
}

async function createAndUploadFileToAlist(size: number) {
  const content = Buffer.alloc(size * 1024 * 1024, '0066ccff', 'hex');
  const uploadUrl = `${davBaseUrl}/measure/${size}MB`;

  try {
    const fileExists = await checkFileExists(uploadUrl);
    if (fileExists) {
      logger.debug(`测速文件已存在，跳过上传: ${uploadUrl}`);
      return;
    }
    await got.put(uploadUrl, {
      body: content,
      headers: {
        Authorization: `Basic ${Buffer.from(`${davStorageUrl.username}:${davStorageUrl.password}`).toString('base64')}`,
        'Content-Type': 'application/octet-stream'
      },
      https: { rejectUnauthorized: false }
    });
    logger.debug(`测速文件已成功上传: ${uploadUrl}`);
  } catch (uploadError: any) {
    logger.error(`测速文件上传失败: ${uploadError}`);
    if (uploadError.response) {
      logger.error(`测速文件上传响应状态码: ${uploadError.response.statusCode}`);
      logger.error(`测速文件上传相应body: ${uploadError.response.body}`);
    }
    throw uploadError;
  }
  return;
}

export async function bootstrap(version: string, protocol_version: string): Promise<void> {
  logger.info(colors.green(`当前版本: ${version}`));
  logger.info(colors.green(`协议版本: ${protocol_version}`));
  logger.debug(colors.yellow(`已开启debug日志`));

  if (config.notifyEnabled) {
    logger.debug(colors.yellow(`已开启通知功能`));
  }
  if (config.notifyDebugMode) {
    notify.send(`Booting Node-OBA-Fix ${version}`)
  }

  const startupFilePath = join('data', 'startup.json');

  // 确保 data 目录存在
  await fs.ensureDir(dirname(startupFilePath));

  // 读取 startup.json 文件，不存在则初始化
  let startupTimes: number[] = [];
  if (await fs.pathExists(startupFilePath)) {
    const data = await fs.readFile(startupFilePath, 'utf-8');
    startupTimes = JSON.parse(data);
  }

  // 删除超过 24 小时的上线记录
  startupTimes = filterRecentStartupTimes(startupTimes);

  // 保存更新后的上线记录
  await fs.writeFile(startupFilePath, JSON.stringify(startupTimes, null, 2), 'utf-8');

  // 检查上线次数是否超过限制
  if (isExceedLimit(startupTimes, startuplimit)) {
    logger.warn(`24h 内启动次数超过 ${startuplimit} 次, 继续启动有被主控封禁的风险, 请输入 yes 进行强制启动`);
    logger.warn(`当前 24h 内启动次数为 ${startupTimes.length} 次`);
    // 创建一个 Promise，等待用户输入或超时
    const answer = await Promise.race([
      new Promise<string>((resolve) => {
        process.stdin.once('data', (data) => resolve(data.toString().trim()));
      }),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('timeout'), STARTUP_LIMIT_WAIT_TIMEOUT*1000);
      }),
    ]);

    if (answer === 'timeout') {
      // 如果超时，则隔一段时间再检查一次是否超限
      logger.warn(`等待回复超时, ${STARTUP_LIMIT_WAIT_TIMEOUT} 秒后再次检测是否超限`);
    
      // 封装为promise
      const checkLimitPromise = new Promise<void>((resolve, reject) => {
        const interval = setInterval(async () => {
          // 读取
          const data = await fs.readFile(startupFilePath, 'utf-8');
          startupTimes = JSON.parse(data);
          // 删除超过 24 小时的上线记录
          startupTimes = filterRecentStartupTimes(startupTimes);
          // 再次判断是否超限
          if (isExceedLimit(startupTimes, startuplimit)) {
            logger.warn(`24h 内上线次数超过 ${startuplimit} 次, 已取消启动`);
            clearInterval(interval); // 停止定时器
            reject(new Error('启动次数超限')); // 拒绝 Promise 
          } else {
            resolve(); // 检查通过，启动!
          }
        }, STARTUP_LIMIT_WAIT_TIMEOUT*1000);
      });
    
      try {
        // 等待定时器的检查结果
        await checkLimitPromise;
      } catch (error) {
        // 超限，退出程序
        process.exit(1);
      }
    } else if (answer.toLowerCase() !== 'yes') {
      logger.warn(`24h 内上线次数超过 ${startuplimit} 次, 已取消启动`);
      process.exit(1);
    }
  }
  
  const tokenManager = new TokenManager(config.clusterId, config.clusterSecret, protocol_version);
  await tokenManager.getToken();
  const cluster = new Cluster(config.clusterSecret, protocol_version, tokenManager);
  await cluster.init();
  if(!config.noConnect){
    cluster.connect();
  }

  let proto: 'http' | 'https' = 'https';
  if (config.byoc) {
    // 当 BYOC 但是没有提供证书时，使用 http
    if (!config.sslCert || !config.sslKey) {
      proto = 'http';
    } else {
      logger.info('使用自定义证书');
      await cluster.useSelfCert();
    }
  } else {
    if(!config.noConnect){
      logger.info('请求证书');
      await cluster.requestCert();
    } else {
      logger.info('已跳过请求证书');
    }
  }

  if (config.enableNginx) {
    logger.debug('正在启用Nginx');
    if (typeof cluster.port === 'number') {
      logger.debug('Nginx端口合法, 正在启动');
      await cluster.setupNginx(join(__dirname, '..'), cluster.port, proto);
    } else {
      throw new Error('Nginx端口不合法');
    }
  }
  logger.debug('正在启动Express服务');
  const server = cluster.setupExpress(proto === 'https' && !config.enableNginx);
  logger.debug('正在监听端口');
  await cluster.listen();
  logger.debug('正在检查端口');
  await cluster.portCheck();

  const storageReady = await cluster.storage.check();
  if (!storageReady) {
    throw new Error('存储异常');
  }

  // 如果是 alist 类型存储，生成 10MB 的测速文件
  if (storageType === 'alist') {
    logger.debug('准备预生成测速文件');
    try {
      // 同时生成 1MB 和 10MB 测速文件
      await Promise.all([
        createAndUploadFileToAlist(1),
        createAndUploadFileToAlist(10),
      ]);
      logger.info('预生成测速文件完毕')
    } catch (error) {
      logger.error(error, '预生成测速文件失败');
      throw new Error('测速文件生成失败');
    }
  }
  

  const configuration = await cluster.getConfiguration();
  const files = await cluster.getFileList();
  sync_logger.info(`云端文件数量: ${files.files.length} files`);

  if (config.disableSyncFiles) {
    // 先检查是否禁用文件同步
    logger.warn('已禁用文件同步');
  } else if(config.disableFirstSyncFiles) {
    logger.warn('已禁用初始文件同步');
  } else {
    // 如果没有禁用同步文件
    try {
      await cluster.syncFiles(files, configuration.sync);
    } catch (e) {
      if (e instanceof HTTPError) {
        sync_logger.error({ url: e.response.url }, '下载失败');
      }
      throw e;
    }
    sync_logger.info('回收文件');
    cluster.gcBackground(files);
  }

  let checkFileInterval: NodeJS.Timeout;

  if (config.noENABLE || config.noConnect) {
    logger.warn('节点上线功能已禁用');
    logger.warn('节点上线功能已禁用');
    logger.warn('节点上线功能已禁用');
    logger.warn('节点上线功能已禁用');
    logger.warn('节点上线功能已禁用');    
    if(config.notifyDebugMode){
      notify.send(`节点上线功能已禁用`)
    }          

    // 在禁用节点上线时也支持同步文件
    if (!config.disableSyncFiles) {
      // 如果没有禁用同步文件
      checkFileInterval = setTimeout(() => {
        void checkFile(files).catch((e) => {
          logger.error(e, '文件检查失败');
        });
        // 每隔一段时间开始同步
      }, ms(syncInterval));
    } else {
      logger.warn('已禁用文件同步');
    }

  } else {
    try {
      logger.info('请求上线');
      await cluster.enable();
      logger.info(colors.rainbow(`节点启动完毕, 正在提供 ${files.files.length} 个文件`));
      if (nodeCluster.isWorker && typeof process.send === 'function') {
        process.send('ready');
      }
      if (!config.disableSyncFiles) {
        // 如果没有禁用同步文件
        checkFileInterval = setTimeout(() => {
          void checkFile(files).catch((e) => {
            logger.error(e, '文件检查失败');
          });
          // 每隔一段时间开始同步
        }, ms(syncInterval));
      } else {
        logger.warn('已禁用文件同步');
      }
    } catch (e) {
      logger.fatal(e);
      if (config.nodeENV === 'development') {
        logger.fatal('调试模式已开启, 不进行退出');
      } else {
        cluster.exit(1);
      }
    }
  }

  async function checkFile(lastFileList: IFileList): Promise<void> {
    try {
      const lastModified = max(lastFileList.files.map((file) => file.mtime));
      const fileList = await cluster.getFileList(lastModified);

      if (!config.AlwaysCheckMissingFiles && fileList.files.length === 0) {
        sync_logger.debug('没有新文件');
        return;
      }

      const configuration = await cluster.getConfiguration();
      await cluster.syncFiles(files, configuration.sync);
      lastFileList = fileList;
    } finally {
      checkFileInterval = setTimeout(() => {
        checkFile(lastFileList).catch((e) => {
          sync_logger.error(e, '文件检查失败');
        });
        // 每隔一段时间开始同步
      }, ms(syncInterval));
    }
  }

  let stopping = false;
  const onStop = async (signal: string): Promise<void> => {
    logger.info(`收到 ${signal}, 正在注销节点`);
    if (stopping) {
      process.exit(1); // eslint-disable-line n/no-process-exit
    }

    stopping = true;
    clearTimeout(checkFileInterval);
    if (cluster.interval) {
      clearInterval(cluster.interval);
    }
    await cluster.disable();

    logger.info('已成功取消注册节点, 正在等待进程结束, 再次按下 Ctrl+C 以强制停止进程');
    server.close();
    cluster.nginxProcess?.kill();
  };
  process.on('SIGTERM', (signal) => {
    void onStop(signal);
  });
  process.on('SIGINT', (signal) => {
    void onStop(signal);
  });

  if (nodeCluster.isWorker) {
    process.on('disconnect', () => {
      void onStop('disconnect');
    });
  }
}
