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
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const storageType = process.env.CLUSTER_STORAGE || 'file'; // 检查存储类型
const davStorageUrl = process.env.CLUSTER_STORAGE_OPTIONS ? JSON.parse(process.env.CLUSTER_STORAGE_OPTIONS) : {};
const davBaseUrl = `${davStorageUrl.url}/${davStorageUrl.basePath}`;

async function makeRequest(
  method: string,
  url: string,
  options: { headers?: Record<string, string>; auth?: { username: string; password: string } },
  body?: Buffer
): Promise<{ status: number; headers: Record<string, string>; data: Buffer }> {
  const isHttps = url.startsWith('https');
  const reqModule = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const { username, password } = options.auth || {};
    const authHeader = username && password ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` : undefined;

    const req = reqModule(
      url,
      {
        method,
        headers: {
          ...options.headers,
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks);
          resolve({ status: res.statusCode || 500, headers: res.headers as Record<string, string>, data });
        });
      }
    );

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// 创建测速文件函数
async function createSpeedTestFile(filename: string, size: number): Promise<void> {
  const redirectUrl = `${davBaseUrl}/${filename}`;
  const content = Buffer.alloc(size * 1024 * 1024, '0066ccff', 'hex');
  try {
    const response = await makeRequest('PUT', redirectUrl, {
      headers: { 'Content-Type': 'application/octet-stream' },
      auth: { username: davStorageUrl.username, password: davStorageUrl.password },
    }, content);

    if (response.status === 200) {
      logger.info(`已生成测速文件: ${filename}`);
    } else {
      logger.error(`生成测速文件失败，状态码: ${response.status}`);
    }
  } catch (error) {
    logger.error(error, `创建测速文件 ${filename} 失败`);
    throw error;
  }
}

export async function bootstrap(version: string): Promise<void> {
  logger.info(colors.green(`Booting Node-OBA-Fix`));
  logger.info(colors.green(`当前版本: 1.3`));
  logger.info(colors.green(`协议版本: ${version}`));
  const tokenManager = new TokenManager(config.clusterId, config.clusterSecret, version);
  await tokenManager.getToken();
  const cluster = new Cluster(config.clusterSecret, version, tokenManager);
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
    if (typeof cluster.port === 'number') {
      await cluster.setupNginx(join(__dirname, '..'), cluster.port, proto);
    } else {
      throw new Error('cluster.port is not a number');
    }
  }
  const server = cluster.setupExpress(proto === 'https' && !config.enableNginx);
  await cluster.listen();
  await cluster.portCheck();

  const storageReady = await cluster.storage.check();
  if (!storageReady) {
    throw new Error('存储异常');
  }

  // 如果是 alist 类型存储，生成 10MB 的测速文件
  if (storageType === 'alist') {
    const speedTestFilename = '10MB';
    try {
      await createSpeedTestFile(speedTestFilename, 10); // 调用生成测速文件函数
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
      logger.error({ url: e.response.url }, 'download error');
    }
    throw e;
  }
  logger.info('回收文件');
  cluster.gcBackground(files);

  let checkFileInterval: NodeJS.Timeout;
  try {
    logger.info('请求上线');
    await cluster.enable();

    logger.info(colors.rainbow(`done, serving ${files.files.length} files`));
    if (nodeCluster.isWorker && typeof process.send === 'function') {
      process.send('ready');
    }

    checkFileInterval = setTimeout(() => {
      void checkFile(files).catch((e) => {
        logger.error(e, 'check file error');
      });
    }, ms('10m'));
  } catch (e) {
    logger.fatal(e);
    if (process.env.NODE_ENV === 'development') {
      logger.fatal('development mode, not exiting');
    } else {
      cluster.exit(1);
    }
  }

  async function checkFile(lastFileList: IFileList): Promise<void> {
    logger.debug('refresh files');
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
          logger.error(e, 'check file error');
        });
      }, ms('10m'));
    }
  }

  let stopping = false;
  const onStop = async (signal: string): Promise<void> => {
    logger.info(`got ${signal}, unregistering cluster`);
    if (stopping) {
      process.exit(1); // eslint-disable-line n/no-process-exit
    }

    stopping = true;
    clearTimeout(checkFileInterval);
    if (cluster.interval) {
      clearInterval(cluster.interval);
    }
    await cluster.disable();

    logger.info('unregister success, waiting for background task, ctrl+c again to force kill');
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
