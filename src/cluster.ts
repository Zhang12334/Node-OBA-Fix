import {decompress} from '@mongodb-js/zstd'
import {ChildProcess, spawn} from 'child_process'
import {MultiBar} from 'cli-progress'
import colors from 'colors/safe.js'
import delay from 'delay'
import express, {type NextFunction, type Request, type Response} from 'express'
import {readFileSync} from 'fs'
import fse from 'fs-extra'
import {mkdtemp, open, readFile, rm} from 'fs/promises'
import got, {type Got, HTTPError, RequestError} from 'got'
import {createServer, Server} from 'http'
import {createSecureServer} from 'http2'
import http2Express from 'http2-express-bridge'
import {Agent as HttpsAgent} from 'https'
import ipaddr from 'ipaddr.js'
import stringifySafe from 'json-stringify-safe'
import {template, toString} from 'lodash-es'
import morgan from 'morgan'
import ms from 'ms'
import {constants} from 'node:http2'
import {userInfo} from 'node:os'
import {tmpdir} from 'os'
import pMap from 'p-map'
import pRetry from 'p-retry'
import {dirname, join, relative, normalize} from 'path'
import prettyBytes from 'pretty-bytes'
import {connect, Socket} from 'socket.io-client'
import {Tail} from 'tail'
import {fileURLToPath} from 'url'
import {config, type OpenbmclapiAgentConfiguration, OpenbmclapiAgentConfigurationSchema} from './config.js'
import {FileListSchema} from './constants.js'
import {validateFile} from './file.js'
import {Keepalive} from './keepalive.js'
import {logger, sync_logger} from './logger.js'
import {notify} from './notify.js'
import {beforeError} from './modules/got-hooks.js'
import {AuthRouteFactory} from './routes/auth.route.js'
import MeasureRouteFactory from './routes/measure.route.js'
import {getStorage, type IStorage} from './storage/base.storage.js'
import type {TokenManager} from './token.js'
import type {IFileList} from './types.js'
import {setupUpnp} from './upnp.js'
import {checkSign, hashToFilename} from './util.js'
import { PanelListener, PanelServe } from './dashboard/main.js';
import chalk from "chalk"

interface ICounters {
  hits: number
  bytes: number
}

const whiteListDomain = ['localhost', 'bangbang93.com']

// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = dirname(fileURLToPath(import.meta.url))
const getCurrentTime = () => {
  const now = new Date();
  return `[${now.toISOString().replace('T', ' ').slice(0, 19)}]`; // 格式化为 [2025-03-29 21:19:26]
};

function getURL(url: string) {
  if (config.disableOptiLog) {
    return chalk.green(url);
  } else {
    return chalk.green(url.split('?')[0]);
  }
}

function extractIP(remoteAddr: string): string {
  // 判断是否是 IPv4-mapped IPv6 地址
  if (remoteAddr.startsWith("::ffff:")) {
    // 提取 IPv4 地址
    return remoteAddr.substring(7); // 去掉 "::ffff:"，保留 IPv4 地址
  } else {
    // 如果是纯 IPv6 地址
    return remoteAddr;
  }
}

export class Cluster {
  public readonly counters: ICounters = {hits: 0, bytes: 0}
  public isEnabled = false
  public wantEnable = false
  public interval?: NodeJS.Timeout
  public nginxProcess?: ChildProcess
  public readonly storage: IStorage

  private readonly prefixUrl = config.ClusterBMCLAPI ?? 'https://openbmclapi.bangbang93.com'
  private host?: string
  private _port: number | string
  private readonly publicPort: number
  private readonly ua: string
  private readonly got: Got
  private readonly requestCache = new Map()
  private readonly tmpDir = join(tmpdir(), 'openbmclapi')
  private readonly keepalive = new Keepalive(ms('1m'), this)
  private readonly downloadPromise = new Map<string, Promise<void>>()
  private socket?: Socket

  private server?: Server

  public constructor(
    private readonly clusterSecret: string,
    private readonly protocol_version: string,
    private readonly tokenManager: TokenManager,
  ) {
    this.host = config.clusterIp
    this._port = config.port
    this.publicPort = config.clusterPublicPort ?? config.port
    this.ua = `openbmclapi-cluster/${protocol_version}`
    whiteListDomain.push(this.prefixUrl)
    this.got = got.extend({
      prefixUrl: this.prefixUrl,
      headers: {
        'user-agent': this.ua,
      },
      responseType: 'buffer',
      timeout: {
        connect: ms('10s'),
        response: ms('10s'),
        request: ms('5m'),
      },
      agent: {
        https: new HttpsAgent({
          keepAlive: true,
        }),
      },
      hooks: {
        beforeRequest: [
          async (options) => {
            const url = options.url
            if (!url) return
            if (typeof url === 'string') {
              if (
                whiteListDomain.some((domain) => {
                  return url.includes(domain)
                })
              ) {
                options.headers.authorization = `Bearer ${await this.tokenManager.getToken()}`
              }
            } else if (
              whiteListDomain.some((domain) => {
                return url.hostname.includes(domain)
              })
            ) {
              options.headers.authorization = `Bearer ${await this.tokenManager.getToken()}`
            }
          },
        ],
        beforeError,
      },
    })
    this.storage = getStorage(config)
  }

  public get port(): number | string {
    return this._port
  }

  public async init(): Promise<void> {
    await this.storage.init?.()
    if (config.enableUpnp) {
      const ip = await setupUpnp(config.port, config.clusterPublicPort)
      const addr = ipaddr.parse(ip)
      if (addr.kind() !== 'ipv4') {
        throw new Error('不支持ipv6')
      }
      if (addr.range() !== 'unicast') {
        throw new Error(`无法获取公网IP, UPNP返回的IP位于私有地址段, IP: ${ip}`)
      }
      logger.info(`upnp映射成功, 外网IP: ${ip}`)
      this.host ??= ip
    }
  }

  public async getFileList(lastModified?: number): Promise<IFileList> {
    sync_logger.info('正在尝试获取云端文件列表');
    const res = await this.got.get('openbmclapi/files', {
      responseType: 'buffer',
      cache: this.requestCache,
      searchParams: {
        lastModified,
      },
    })
    if (res.statusCode === constants.HTTP_STATUS_NO_CONTENT) {
      return {
        files: [],
      }
    }
    const decompressed = await decompress(res.body)
    return {
      files: FileListSchema.fromBuffer(Buffer.from(decompressed)) as IFileList['files'],
    }
  }

  public async getConfiguration(): Promise<OpenbmclapiAgentConfiguration> {
    const res = await this.got.get('openbmclapi/configuration', {
      responseType: 'json',
      cache: this.requestCache,
    })
    return OpenbmclapiAgentConfigurationSchema.parse(res.body)
  }

  public async syncFiles(fileList: IFileList, syncConfig: OpenbmclapiAgentConfiguration['sync']): Promise<void> {
  if (!config.skipStorageCheck) {
    const storageReady = await this.storage.check();
    if (!storageReady) {
      throw new Error('存储异常');
    }
  } else {
    logger.warn('已跳过存储检查');
  }
    sync_logger.info('正在检查缺失文件')
    const missingFiles = await this.storage.getMissingFiles(fileList.files)
    if (missingFiles.length === 0) {
      sync_logger.info(`没有新文件`)
      return
    } else {
      sync_logger.info(`缺少 ${missingFiles.length} 个文件, 正在开始同步`)
    }
    
    const parallel =
      config.syncConcurrency === undefined || config.syncConcurrency < 1
          ? syncConfig.concurrency
          : config.syncConcurrency > 20
          ? 20
          : config.syncConcurrency;
    
    sync_logger.info(`同步源: ${syncConfig.source}`)
    sync_logger.info(`同步并发数: ${parallel}`)

    let newmultibar: any;
    let oldmultibar: any;

    if (!config.disableNewSyncStatus) {
      // 新的样式
      newmultibar = new MultiBar({
        format: `${getCurrentTime()} ${chalk.green('INFO')}${chalk.white(':')} ${chalk.blue('[Sync] 同步进度 {value}/{total} | {bar} |')}`, // 虽然不是同一个log系统，但就是要一个效果，别问，问就是好看
        noTTYOutput: true,
        notTTYSchedule: ms('10s'),
      });
    } else {
      // 旧样式
      oldmultibar = new MultiBar({
        format: ' {bar} | {filename} | {value}/{total}',
        noTTYOutput: true,
        notTTYSchedule: ms('10s'),
      });
    }
    
    let totalBar;
    if (!config.disableNewSyncStatus) {
      // 新样式
      totalBar = newmultibar.create(missingFiles.length, 0, {filename: '总文件数'})
    } else {
      // 旧样式
      totalBar = oldmultibar.create(missingFiles.length, 0, {filename: '总文件数'})
    }
    let hasError = false
    await pMap(
      missingFiles,
      async (file) => {
        let bar: any;
        if (config.disableNewSyncStatus) {
          bar = oldmultibar.create(file.size, 0, { filename: file.path });
        }       
        try {
          await pRetry(
            async () => {
              if (config.disableNewSyncStatus) {
                bar.update(0)
              }
              const res = await this.got
                .get<Buffer>(file.path.substring(1), {
                  retry: {
                    limit: 0,
                  },
                })
                .on('downloadProgress', (progress) => {
                  if (config.disableNewSyncStatus) {
                    bar.update(progress.transferred)
                  }
                })

              const isFileCorrect = validateFile(res.body, file.hash)
              if (!isFileCorrect) {
                throw new RequestError(`文件${file.path}校验失败`, new Error(`文件${file.path}校验失败`), res.request)
              }
              await this.storage.writeFile(hashToFilename(file.hash), res.body, file)
            },
            {
              retries: 10,
              onFailedAttempt: async (e) => {
                if (e instanceof HTTPError) {
                  logger.debug(
                    {redirectUrls: e.response.redirectUrls},
                    `下载文件${file.path}失败: ${e.response.statusCode}`,
                  )
                  logger.trace({err: e}, toString(e.response.body))
                } else {
                  logger.debug({err: e}, `下载文件${file.path}失败，正在重试`)
                }

                if (e instanceof RequestError) {
                  const redirectUrls = e.response?.redirectUrls
                  if (redirectUrls?.length) {
                    const urls = [
                      new URL(file.path, this.prefixUrl).toString(),
                      ...redirectUrls.map((e) => e.toString()),
                    ]
                    await this.got
                      .post('openbmclapi/report', {
                        json: {
                          urls,
                          error: stringifySafe({message: e.message}),
                        },
                      })
                      .catch((e) => {
                        logger.error(e, '上报重定向失败')
                      })
                  }
                }
              },
            },
          )
        } catch (e) {
          hasError = true
          if (e instanceof HTTPError) {
            logger.error(
              {redirectUrls: e.response.redirectUrls},
              `下载文件${file.path}失败: ${e.response.statusCode}, url: ${e.response.url}`,
            )
            logger.trace({err: e}, toString(e.response.body))
          } else {
            logger.error({err: e}, `下载文件${file.path}失败`)
          }
        } finally {
          totalBar.increment()
          if (config.disableNewSyncStatus) {
            bar.stop()
            oldmultibar.remove(bar)
          }
        }
      },
      {
        concurrency: parallel,
      },
    )
    if (!config.disableNewSyncStatus) {
      // 新样式
      newmultibar.stop()
    } else {
      // 旧样式
      oldmultibar.stop()
    }
    if (hasError) {
      throw new Error('同步失败')
    } else {
      logger.info('同步完成')
    }
  }

  public setupExpress(https: boolean): Server {
    morgan.token('datetime', () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
    
      return `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
    });
    const app = http2Express(express)
    app.enable('trust proxy')

    app.get('/auth', AuthRouteFactory(config))

    // 花里胡哨的LOG
    if (!config.disableAccessLog) {
      var formattedDate: string;
      // 第一行：请求日志
      app.use(
        morgan((tokens, req, res) => {
          const status = res.statusCode;
          const statusColor =
            status >= 500
              ? chalk.red.bold
              : status >= 400
              ? chalk.yellow.bold
              : status >= 300
              ? chalk.cyan.bold
              : status >= 200
              ? chalk.green.bold
              : chalk.white.bold;
    
          // 获取时间并检查是否为有效值
          const rawDate = tokens.date(req, res);
          const date = rawDate ? new Date(rawDate) : new Date(); // 如果 rawDate 是 undefined，使用当前时间

          // 格式化日期并保存：YYYY-MM-DD HH:MM:SS
          formattedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
          
          // 提取纯 IPv6 或 IPv4 地址
          const remoteAddr = tokens["remote-addr"](req, res);
          const extractedIP = remoteAddr ? extractIP(remoteAddr) : "unknown";

          // 拼接
          return [
            chalk.white(`[${formattedDate}]`), // 时间（白色）
            chalk.green('INFO:'), // info前缀
            chalk.blue(`[${extractedIP}]`), // 提取的 IP 地址（蓝色）
            statusColor(`Response ${tokens.status(req, res)}`), // 状态码（彩色）
            "→",
            getURL(tokens.url(req, res) as string),
          ].join(" ");
        })
      );
    
      // 第二行：响应日志
      app.use(
        morgan((tokens, req, res) => {

          // 获取响应时间并去除 "ms"
          const responseTimeRaw = tokens["response-time"](req, res);
          const responseTime = responseTimeRaw ? parseFloat(responseTimeRaw.replace(' ms', '')) : 0; // 爆了就直接0ms，没说就是零卡！ 

          // 根据响应时间设置颜色
          let responseTimeColor = chalk.green; // 默认绿色
          if (responseTime >= 500 && responseTime <= 5000) {
            responseTimeColor = chalk.yellow; // 介于 0.5s 到 5s 之间为黄色
          } else if (responseTime > 5000) {
            responseTimeColor = chalk.hex('#FFA500'); // 大于 5s 为橙色
          }

          // 提取纯 IPv6 或 IPv4 地址
          const remoteAddr = tokens["remote-addr"](req, res);
          const extractedIP = remoteAddr ? extractIP(remoteAddr) : "unknown";

          // 拼接
          return [
            chalk.white(`[${formattedDate}]`), // 时间（白色）
            chalk.green('INFO:'), // INFO 前缀
            chalk.blue(`[${extractedIP}]`), // 提取的 IP 地址（蓝色）
            chalk.white(`HTTP/${tokens["http-version"](req, res)}`), // HTTP 版本（白色）
            chalk.gray('|'), // 分隔符
            responseTimeColor(`${responseTime} ms`), // 响应时间
            chalk.gray('|'), // 分隔符
            chalk.cyan(tokens["user-agent"](req, res)), // UA（青色）
          ].join(" ");
        })
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    PanelServe(app, this.storage);
    app.get('/download/:hash(\\w+)', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const hash = req.params.hash.toLowerCase()
        const signValid = checkSign(hash, this.clusterSecret, req.query as NodeJS.Dict<string>)
        if (!signValid && !config.allowNoSign) {
          return res.status(403).send('invalid sign')
        }

        const hashPath = hashToFilename(hash)
        if (!(await this.storage.exists(hashPath))) {
          // 如果不存在此文件
          if (config.disableSyncFiles) {
            // 如果关闭了同步文件功能, 直接404
            return res.status(404).send('File Not Found');
          }
          // 尝试同步文件
          if (this.downloadPromise.has(hash)) {
            await this.downloadPromise.get(hash)
          } else {
            const promise = this.downloadFile(hash)
            try {
              this.downloadPromise.set(hash, promise)
              await promise
            } finally {
              this.downloadPromise.delete(hash)
            }
          }
        }
        res.set('x-bmclapi-hash', hash)
        const {bytes, hits} = await this.storage.express(hashPath, req, res, next)
        PanelListener(req, bytes, hits);
        this.counters.bytes += bytes
        this.counters.hits += hits
      } catch (err) {
        if (err instanceof HTTPError) {
          if (err.response.statusCode === 404) {
            return next()
          }
        }
        return next(err)
      }
    })
    app.use('/measure', MeasureRouteFactory(config, this.storage));
    let server: Server
    if (https) {
      server = createSecureServer(
        {
          key: readFileSync(join(this.tmpDir, 'key.pem'), 'utf8'),
          cert: readFileSync(join(this.tmpDir, 'cert.pem'), 'utf8'),
          allowHTTP1: true,
        },
        app,
      ) as unknown as Server
    } else {
      server = createServer(app)
    }
    this.server = server

    return server
  }

  public async setupNginx(pwd: string, appPort: number, proto: string): Promise<void> {
    this._port = '/tmp/openbmclapi.sock'
    await rm(this._port, {force: true})
    const dir = await mkdtemp(join(tmpdir(), 'openbmclapi'))
    const confFile = `${dir}/nginx/nginx.conf`
    const templateFile = 'nginx.conf'
    const confTemplate = await readFile(join(__dirname, '..', 'nginx', templateFile), 'utf8')
    logger.debug('nginx conf', confFile)

    await fse.copy(join(__dirname, '..', 'nginx'), dirname(confFile), {recursive: true, overwrite: true})
    await fse.outputFile(
      confFile,
      template(confTemplate)({
        root: pwd,
        port: appPort,
        ssl: proto === 'https',
        sock: this._port,
        user: userInfo().username,
        tmpdir: this.tmpDir,
      }),
    )

    const logFile = join(__dirname, '..', 'access.log')
    const logFd = await open(logFile, 'a')
    await fse.ftruncate(logFd.fd)

    this.nginxProcess = spawn('nginx', ['-c', confFile], {
      stdio: [null, logFd.fd, 'inherit'],
    })

    await delay(ms('1s'))

    if (this.nginxProcess.exitCode !== null) {
      throw new Error(`Nginx 以 ${this.nginxProcess.exitCode} 退出码退出`)
    }

    const tail = new Tail(logFile)
    if (!config.disableAccessLog) {
      tail.on('line', (line: string) => {
        process.stdout.write(line)
        process.stdout.write('\n')
      })
    }

    const logRegexp =
      /^(?<client>\S+) \S+ (?<userid>\S+) \[(?<datetime>[^\]]+)] "(?<method>[A-Z]+) (?<request>[^ "]+)? HTTP\/[0-9.]+" (?<status>[0-9]{3}) (?<size>[0-9]+|-) "(?<referrer>[^"]*)" "(?<useragent>[^"]*)"/
    tail.on('line', (line: string) => {
      const match = line.match(logRegexp)
      if (!match) {
        logger.debug(`无法解析 nginx 日志: ${line}`)
        return
      }
      this.counters.hits++
      this.counters.bytes += parseInt(match.groups?.size ?? '0', 10) || 0
    })

    this.interval = setInterval(() => {
      void fse.ftruncate(logFd.fd)
    }, ms('60s'))
  }

  public async listen(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) {
        throw new Error('服务尚未初始化')
      }
      this.server.listen(this._port, resolve)
      logger.debug('端口已监听');
    })
  }

  public connect(): void {
    if (this.socket?.connected) return
    this.socket = connect(this.prefixUrl, {
      transports: ['websocket'],
      auth: (cb) => {
        this.tokenManager
          .getToken()
          .then((token) => {
            cb({token})
          })
          .catch((e) => {
            logger.error(e, '获取 Token 失败')
            this.exit(1)
          })
      },
    })
    this.socket.on('error', this.onConnectionError.bind(this, 'error'))
    this.socket.on('message', (msg) => {
      logger.info(msg)
    })
    this.socket.on('connect', () => {
      logger.debug('已连接至主控')
    })
    this.socket.on('disconnect', (reason) => {
      logger.warn(`与主控断开连接: ${reason}`)
      this.isEnabled = false
      this.keepalive.stop()
    })
    this.socket.on('exception', (err) => {
      logger.error(err, 'exception')
    })
    this.socket.on('warden-error', (data) => {
      logger.warn(data, '主控回报巡检异常')
      logger.debug("主控回报信息: ", data)
    })

    const io = this.socket.io
    io.on('reconnect', (attempt: number) => {
      if (config.restartProcess !== false) {
        logger.info(`在重试${attempt}次后恢复连接`)
        if (this.wantEnable) {
          logger.info('正在尝试重新启用服务')
          this.enable()
            .then(() => {
              logger.info('重试连接并且准备就绪');
              if (config.notifyEnabled) {
                notify.send(config.notifyReconnectMessage || "节点已重新连接"); 
              }
            })
            .catch(this.onConnectionError.bind(this, 'reconnect'))
        }
      }
      // 不启用自动重启
      logger.info('已跳过重新启用服务');
      this.exit(1);
    })
    io.on('reconnect_error', (err) => {
      logger.error(err, 'reconnect_error')
    })
    io.on('reconnect_failed', this.onConnectionError.bind(this, 'reconnect_failed', new Error('reconnect failed')))
  }

  public async portCheck(): Promise<void> {
    await this.socket?.emitWithAck('port-check', {
      host: this.host,
      port: this.publicPort,
      version: this.protocol_version,
      byoc: config.byoc,
      noFastEnable: config.noFastEnable === true,
      flavor: config.flavor,
    })
  }

  public async enable(): Promise<void> {
    if (this.isEnabled) return
    logger.trace('enable')
    await this._enable()
    this.isEnabled = true
    this.wantEnable = true
  }

  public async disable(): Promise<void> {
    if (!this.socket) return
    this.keepalive.stop()
    this.wantEnable = false
    const [err, ack] = (await this.socket.emitWithAck('disable', null)) as [object, boolean]
    this.isEnabled = false
    if (err) {
      if (typeof err === 'object' && 'message' in err) {
        throw new Error(err.message as string)
      }
    }
    if (!ack) {
      throw new Error('节点禁用失败')
    }
    this.socket?.disconnect()
    if (config.notifyEnabled) {
      notify.send(config.notifyShutdownMessage || "节点已下线"); 
    }
  }

  public async downloadFile(hash: string): Promise<void> {
    const res = await this.got.get(`openbmclapi/download/${hash}`, {
      responseType: 'buffer',
      searchParams: { noopen: 1 },
    });
  
    await this.storage.writeFile(hashToFilename(hash), res.body, {
      path: `/download/${hash}`,
      hash,
      size: res.body.length,
      mtime: Date.now(),
    });
  }
  

  public async requestCert(): Promise<void> {
    logger.debug('正在尝试请求证书');
    if (!this.socket) {
        throw new Error('未连接到服务器');
    }

    logger.debug('正在通过 socket 请求证书');
    const [err, cert] = (await this.socket.emitWithAck('request-cert')) as [object, {cert: string; key: string}];

    if (err) {
        logger.debug('请求证书时发生错误', err);
        if (typeof err === 'object' && 'message' in err) {
            throw new Error(err.message as string);
        } else {
            throw new Error('请求证书失败', {cause: err});
        }
    }

    logger.debug('证书请求成功，正在保存证书文件');
    await fse.outputFile(join(this.tmpDir, 'cert.pem'), cert.cert);
    await fse.outputFile(join(this.tmpDir, 'key.pem'), cert.key);
    logger.debug('证书文件保存成功');
  }


  public async useSelfCert(): Promise<void> {
    if (!config.sslCert) {
      throw new Error('缺少 ssl 证书')
    }
    if (!config.sslKey) {
      throw new Error('缺少 ssl 私钥')
    }

    if (await fse.pathExists(config.sslCert)) {
      await fse.copy(config.sslCert, join(this.tmpDir, 'cert.pem'))
    } else {
      await fse.outputFile(join(this.tmpDir, 'cert.pem'), config.sslCert)
    }
    if (await fse.pathExists(config.sslKey)) {
      await fse.copy(config.sslKey, join(this.tmpDir, 'key.pem'))
    } else {
      await fse.outputFile(join(this.tmpDir, 'key.pem'), config.sslKey)
    }
  }

  public exit(code: number = 0): void {
    if (this.nginxProcess) {
      this.nginxProcess.kill()
    }
    // eslint-disable-next-line n/no-process-exit
    process.exit(code)
  }

  public gcBackground(files: IFileList): void {
    const measurePath = normalize('measure/');
  
    // 过滤掉 measure
    const filteredFiles = files.files.filter((file) => {
      const relativePath = relative(measurePath, file.path);
      return relativePath.startsWith('..'); // 如果文件不在 measure 内，返回
    });
  
    // GC过滤后的文件
    this.storage
      .gc(filteredFiles)
      .then((res) => {
        if (res.count === 0) {
          logger.info('没有过期文件');
        } else {
          logger.info(`文件回收完成，共删除 ${res.count} 个文件，释放空间 ${prettyBytes(res.size)}`);
        }
      })
      .catch((e: unknown) => {
        logger.error({ err: e }, 'gc error');
      });
  }
  

  private async _enable(): Promise<void> {
    let err: unknown
    let ack: unknown
    const timestamp = Date.now();
    const filePath = join(__dirname, '../data/startup.json');
    try {
      // 读
      let startupTimes: number[] = [];
      if (await fse.pathExists(filePath)) {
        const data = await fse.readFile(filePath, 'utf-8');
        startupTimes = JSON.parse(data);
      }
    
      // 加
      startupTimes.push(timestamp);
    
      // 写
      await fse.writeFile(filePath, JSON.stringify(startupTimes, null, 2), 'utf-8');
    } catch (e) {
      // 爆!
      logger.error('写入启动时间戳失败', e);
    }

    if (!this.socket) {
      throw new Error('未连接到服务器')
    }
    try {
      const res = (await this.socket.timeout(ms('5m')).emitWithAck('enable', {
        host: this.host,
        port: this.publicPort,
        version: this.protocol_version,
        byoc: config.byoc,
        noFastEnable: config.noFastEnable === true,
        flavor: config.flavor,
      })) as unknown
      if (Array.isArray(res)) {
        ;[err, ack] = res as unknown[]
      }
    } catch (e) {
      throw new Error('节点注册超时', {cause: e})
    }

    if (err) {
      if (typeof err === 'object' && 'message' in err) {
        throw new Error(err.message as string)
      }
    }
    if (ack !== true) {
      throw new Error('节点注册失败')
    }

    logger.info(colors.rainbow('开始提供服务'))
    this.keepalive.start(this.socket)
  }

  private onConnectionError(event: string, err: Error): void {
    logger.error(`${event}: 无法连接至主控`, err)
    if (this.server) {
      this.server.close(() => {
        this.exit(1)
      })
    } else {
      this.exit(1)
    }
  }
}
