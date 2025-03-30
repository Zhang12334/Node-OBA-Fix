import cluster from 'cluster'
import {config as dotenvConfig} from 'dotenv'
import {readFileSync} from 'fs'
import ms from 'ms'
import {fileURLToPath} from 'url'
import {bootstrap} from './bootstrap.js'
import {logger} from './logger.js'
import {webhook} from './webhook.js'
import {config} from './config.js'
import colors from 'colors/safe.js';
import path from 'path';
import { exec, execSync } from 'child_process';
import AdmZip from 'adm-zip';
import fetch from 'node-fetch';
import fs from 'fs';

const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  protocol_version: string
  version: string
}

// 加载env
dotenvConfig()

// 如果以非守护进程模式运行，直接启动应用
if (process.env.NO_DAEMON || !cluster.isPrimary) {
  bootstrap(packageJson.version, packageJson.protocol_version).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err)
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })
}

// 如果以守护进程模式运行，创建子进程
if (!process.env.NO_DAEMON && cluster.isPrimary) {
  checkUpdate().then(() => {
    forkWorker();
  });
}

// 检查更新
async function checkUpdate(): Promise<void> {
  logger.info(colors.green(`正在检查更新`));
  const currentVersion = config.version;
  const latestVersionUrl = "https://api.github.com/repos/Zhang12334/Node-OBA-Fix/releases/latest";
  const response = await fetch(latestVersionUrl, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const data = await response.json() as { tag_name: string; body: string };
  const latestVersion = data.tag_name; // 获取最新版本

  if (!latestVersion) {
      logger.warn("检查更新失败！");
      return;
  }

  if (isVersionGreater(latestVersion, currentVersion)) {
      logger.warn(`发现新版本: ${latestVersion}`);
      logger.warn(`更新内容如下`);
      parseMarkdownAndLog(data.body);
      if (!config.enableAutoUpdate){
        logger.warn(`下载地址: https://github.com/Zhang12334/Node-OBA-Fix/releases/latest`);
        logger.warn("旧版本可能会导致问题，请尽快更新！");
      } else {
        logger.info(`正在自动更新...`);
        await checkNpmVersion(latestVersion);
      }
  } else {
      logger.info("当前已是最新版本！");
  }
}

async function checkNpmVersion(latestVersion: string) {
  try {
      // 检查是否存在 npm 环境
      logger.info(`正在检查 NPM 版本`);
      const npmVersion = execSync('npm -v').toString().trim();
      const npmVersionNumber = parseFloat(npmVersion);

      // 检查 npm 版本是否大于 10
      if (npmVersionNumber > 10) {
          logger.info(`开始更新`);
          await downloadAndUpdate(latestVersion);
      } else {
          logger.warn(colors.yellow(`自动更新失败: NPM 版本过低 (${npmVersion}), 请进行手动更新`));
          logger.warn(colors.yellow(`下载地址: https://github.com/Zhang12334/Node-OBA-Fix/releases/latest`));
          logger.warn(colors.yellow("旧版本可能会导致问题，请尽快更新！"));          
      }
  } catch (error) {
      logger.error(`自动更新失败: 未检测到本地 NPM 环境, 请进行手动更新`);
      logger.warn(colors.yellow(`下载地址: https://github.com/Zhang12334/Node-OBA-Fix/releases/latest`));
      logger.warn(colors.yellow("旧版本可能会导致问题，请尽快更新！"));          
  }
}

// 解析 markdown 文本
function parseMarkdownAndLog(body: string): void {
  const lines = body.split("\r\n").filter(line => line.trim() !== "");

  let lastPrefix = ""; // 记录上一行的前缀
  for (const line of lines) {
      let output = "";

      if (line.startsWith("# ")) {
          // 标题
          lastPrefix = "🔹";
          output = `${lastPrefix} **${line.replace(/^# /, "")}**`;
      } else if (line === "---") {
          // 分割线
          lastPrefix = "---";
          output = "---";
      } else {
          // 普通文本，继承前面一行的前缀
          lastPrefix = lastPrefix || "-"; // 如果前面没有前缀，则默认用 `-`
          output = `${lastPrefix} ${line}`;
      }

      logger.warn(output);
  }
}


// 版本比较
function isVersionGreater(latestVersion: string, currentVersion: string): boolean {
  const v1Parts = latestVersion.split(".").map(Number);
  const v2Parts = currentVersion.split(".").map(Number);

  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const v1Part = v1Parts[i] ?? 0;
      const v2Part = v2Parts[i] ?? 0;
      if (v1Part > v2Part) return true;
      if (v1Part < v2Part) return false;
  }
  return false;
}

async function downloadAndUpdate(latestVersion: string): Promise<void> {
  // 获取当前文件的路径
  const __filename = fileURLToPath(import.meta.url);
  // 获取当前文件的目录
  const __dirname = path.dirname(__filename);
  // 获取项目根目录（dist 的上一级目录）
  const rootDir = path.resolve(__dirname, '..');

  try {
    // 下载更新包
    const downloadUrl = `https://github.com/Zhang12334/Node-OBA-Fix/releases/latest/download/update.zip`;
    logger.info(colors.green(`正在下载更新包`));
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error(`下载更新包失败: ${response.statusText}`);
    if (!response.body) throw new Error("下载更新包失败: 返回body为空");

    // 保存到临时文件
    const tempZipPath = path.join(rootDir, 'update.zip');
    const writer = fs.createWriteStream(tempZipPath);
    response.body.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // 解压更新包
    logger.info(colors.green(`正在解压更新包`));
    const zip = new AdmZip(tempZipPath);
    const tempDir = path.join(rootDir, 'temp_update');
    zip.extractAllTo(tempDir, true);

    // 替换本地文件
    logger.info(colors.green(`正在替换本地dist文件`));
    const distPath = path.join(tempDir, 'dist');
    logger.info(colors.green(`正在替换本地package.json文件`));
    const packageJsonPath = path.join(tempDir, 'package.json');
    if (!fs.existsSync(distPath) || !fs.existsSync(packageJsonPath)) {
      throw new Error("更新包内容不完整！");
    }

    // 删除旧文件
    logger.info(colors.green(`正在删除旧文件`));
    const oldDistPath = path.join(rootDir, 'dist');
    const oldPackageJsonPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(oldDistPath)) fs.rmSync(oldDistPath, { recursive: true });
    if (fs.existsSync(oldPackageJsonPath)) fs.rmSync(oldPackageJsonPath);

    // 复制新文件
    logger.info(colors.green(`正在复制新文件`));
    fs.renameSync(distPath, oldDistPath);
    fs.renameSync(packageJsonPath, oldPackageJsonPath);

    // 安装依赖
    await new Promise((resolve, reject) => {
      logger.info(colors.green(`正在安装依赖`));
      exec('npm -registry https://npmreg.proxy.ustclug.org/ install', (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`npm install 失败: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });

    // 删除临时文件
    logger.info(colors.green(`正在删除临时文件`));
    fs.rmSync(tempZipPath);
    fs.rmSync(tempDir, { recursive: true });

    logger.info(colors.green(`更新成功！版本: ${latestVersion}`));
    logger.info("正在退出程序...");

    // 重启程序
    process.exit(0); // 退出程序
  } catch (error: any) {
    logger.error("自动更新失败, 请检查你的网络是否能够连接到 Github!");
    logger.error(`失败原因: ${error.message}`);
  }
}

const BACKOFF_FACTOR = 2
let backoff = 1
let isExiting = false

function forkWorker(): void {
  const worker = cluster.fork()

  // 监听退出
  worker.on('exit', (code, signal) => {
    if (process.env.RESTART_PROCESS === 'false') {
      // 不启用自动重启
      const delay = parseInt(process.env.EXIT_DELAY || '3', 10) * 1000
      isExiting = true

      logger.warn(`工作进程 ${worker.id} 异常退出, code: ${code}, signal: ${signal}, ${delay / 1000}秒后退出进程`)  

      if (config.enableWebhookError) {
        webhook.send(config.WebhookErrorMessage || `工作进程 ${worker.id} 异常退出, code: ${code}, signal: ${signal}, ${delay / 1000}秒后退出进程`); 
      }

      // 延迟
      setTimeout(() => {
        process.exit(1);
      }, delay);
    } else {
      // 启用自动重启
      const delay = process.env.ENABLE_EXIT_DELAY === 'true'
        ? parseInt(process.env.EXIT_DELAY || '3', 10) * 1000 // 使用自定义延迟退出时间
        : backoff * 1000 // 使用退避策略

      logger.warn(`工作进程 ${worker.id} 异常退出, code: ${code}, signal: ${signal}, ${delay / 1000}秒后重启`)

      if (config.enableWebhookError) {
        webhook.send(config.WebhookErrorMessage || `工作进程 ${worker.id} 异常退出, code: ${code}, signal: ${signal}, ${delay / 1000}秒后重启`); 
      }

      setTimeout(() => forkWorker(), delay)

      // 如果未启用自定义延迟, 更新退避时间
      if (process.env.ENABLE_EXIT_DELAY !== 'true') {
        backoff = Math.min(backoff * BACKOFF_FACTOR, 60)
      }
    }
  })

  worker.on('message', (msg: unknown) => {
    if (msg === 'ready') {
      backoff = 1 // 重置退避时间
    }
  })

  function onStop(signal: string): void {
    if (isExiting) {
      logger.warn('正在强制退出...')
      process.exit(1)
    }
  
    isExiting = true
    process.off('SIGINT', onStop)
    process.off('SIGTERM', onStop)
  
    worker.removeAllListeners('exit')
    worker.kill(signal)
  
    const forceExitTimer = setTimeout(() => {
      logger.warn('退出超时, 正在强制退出...')
      process.exit(1)
    }, ms('30s')).unref()
  
    worker.once('exit', () => {
      clearTimeout(forceExitTimer)
      process.exit(0)
    })
  }
  
  process.on('SIGINT', onStop)
  process.on('SIGTERM', onStop)
}
