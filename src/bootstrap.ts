import nodeCluster from 'cluster';
import colors from 'colors/safe.js';
import { HTTPError } from 'got';
import { max } from 'lodash-es';
import ms from 'ms';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { Cluster } from './cluster.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { TokenManager } from './token.js';
import { IFileList } from './types.js';
import got from 'got';

const davStorageUrl = process.env.CLUSTER_STORAGE_OPTIONS ? JSON.parse(process.env.CLUSTER_STORAGE_OPTIONS) : {};
const davBaseUrl = `${davStorageUrl.url}/${davStorageUrl.basePath}`;
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const storageType = process.env.CLUSTER_STORAGE || 'file'; // 检查存储类型

async function createAndUploadFileToAlist(size: number): Promise<string> {
  const content = Buffer.alloc(size * 1024 * 1024, '0066ccff', 'hex');
  const uploadUrl = `${davBaseUrl}/measure/${size}MB`;

  try {
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
  return uploadUrl;
}

export async function bootstrap(version: string, protocol_version: string): Promise<void> {
  logger.info(colors.green(`Booting Node-OBA-Fix`));
  logger.info(colors.green(`当前版本: ${version}`));
  logger.info(colors.green(`协议版本: ${protocol_version}`));
  const tokenManager = new TokenManager(config.clusterId, config.clusterSecret, protocol_version);
  await tokenManager.getToken();
  const cluster = new Cluster(config.clusterSecret, protocol_version, tokenManager);
  await cluster.init();
  cluster.connect();

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
    logger.info('请求证书');
    await cluster.requestCert();
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
    logger.debug('准备生成测速文件');
    try {
      // 同时生成 1MB 和 10MB 测速文件
      await Promise.all([
        createAndUploadFileToAlist(1),
        createAndUploadFileToAlist(10),
      ]);
    } catch (error) {
      logger.error(error, '生成测速文件失败');
      throw new Error('测速文件生成失败');
    }
  }
  

  const configuration = await cluster.getConfiguration();
  const files = await cluster.getFileList();
  logger.info(`${files.files.length} files`);
  try {
    await cluster.syncFiles(files, configuration.sync);
  } catch (e) {
    if (e instanceof HTTPError) {
      logger.error({ url: e.response.url }, '下载失败');
    }
    throw e;
  }
  logger.info('回收文件');
  cluster.gcBackground(files);

  let checkFileInterval: NodeJS.Timeout;
  try {
    logger.info('请求上线');
    await cluster.enable();

    logger.info(colors.rainbow(`节点启动完毕, 正在提供 ${files.files.length} 个文件`));
    if (nodeCluster.isWorker && typeof process.send === 'function') {
      process.send('ready');
    }

    checkFileInterval = setTimeout(() => {
      void checkFile(files).catch((e) => {
        logger.error(e, '文件检查失败');
      });
    }, ms('10m'));
  } catch (e) {
    logger.fatal(e);
    if (process.env.NODE_ENV === 'development') {
      logger.fatal('调试模式已开启, 不进行退出');
    } else {
      cluster.exit(1);
    }
  }

  async function checkFile(lastFileList: IFileList): Promise<void> {
    logger.debug('刷新文件中');
    try {
      const lastModified = max(lastFileList.files.map((file) => file.mtime));
      const fileList = await cluster.getFileList(lastModified);
      if (fileList.files.length === 0) {
        logger.debug('没有新文件');
        return;
      }
      const configuration = await cluster.getConfiguration();
      await cluster.syncFiles(files, configuration.sync);
      lastFileList = fileList;
    } finally {
      checkFileInterval = setTimeout(() => {
        checkFile(lastFileList).catch((e) => {
          logger.error(e, '文件检查失败');
        });
      }, ms('10m'));
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
