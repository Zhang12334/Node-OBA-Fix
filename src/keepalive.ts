import Bluebird from 'bluebird'
import {clone} from 'lodash-es'
import ms from 'ms'
import {clearTimeout} from 'node:timers'
import pTimeout from 'p-timeout'
import prettyBytes from 'pretty-bytes'
import {Socket} from 'socket.io-client'
import {Cluster} from './cluster.js'
import {logger} from './logger.js'

export class Keepalive {
  public timer?: NodeJS.Timeout
  private socket?: Socket
  private keepAliveErrors: number[] = []; // 记录失败时间戳
  private readonly MAX_KEEP_ALIVE_FAILURES = 5; // 最大允许失败次数
  private readonly FAILURE_WINDOW_MS = 10 * 60 * 1000; // 10分钟时间窗口
  private readonly INITIAL_TIMEOUT_MS: number = ms('15s'); // 15秒
  private readonly BACKOFF_FACTOR: number = 2; // 每次失败后超时时间翻倍
  private readonly MAX_TIMEOUT_MS: number = ms('2m'); // 2分钟
  private currentTimeoutMs: number = this.INITIAL_TIMEOUT_MS; // 当前超时时间

  constructor(
    private readonly interval: number,
    private readonly cluster: Cluster,
  ) {}

  public start(socket: Socket): void {
    this.socket = socket
    this.schedule()
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      logger.trace('开始保活')
      void this.emitKeepAlive()
    }, this.interval)
  }

  private async emitKeepAlive(): Promise<void> {
    try {
      // 执行保活检测（初始超时时间为15s）
      const status = await pTimeout(this.keepAlive(), {
        milliseconds: this.currentTimeoutMs,
      });
  
      // 主控踹下线
      if (!status) {
        logger.fatal('节点被主控踢下线');
        return await this.restart(); // 立即重启
      }
  
      // 保活成功时清除历史错误记录，并重置超时时间
      this.keepAliveErrors = [];
      this.currentTimeoutMs = this.INITIAL_TIMEOUT_MS; // 重置为初始超时时间
  
    } catch (e) {
      const now = Date.now();
  
      // 删去旧记录
      this.keepAliveErrors = this.keepAliveErrors.filter(
        timestamp => now - timestamp <= this.FAILURE_WINDOW_MS
      );
  
      // 写入本次失败时间戳
      this.keepAliveErrors.push(now);
      logger.error(e, `保活失败（失败 ${this.keepAliveErrors.length}/${this.MAX_KEEP_ALIVE_FAILURES} 次）`);
  
      // 应用退避策略：增加超时时间
      this.currentTimeoutMs = Math.min(
        this.currentTimeoutMs * this.BACKOFF_FACTOR,
        this.MAX_TIMEOUT_MS
      );
  
      // 判断是否重启
      if (this.keepAliveErrors.length >= this.MAX_KEEP_ALIVE_FAILURES) {
        logger.error(`10分钟内保活失败${this.MAX_KEEP_ALIVE_FAILURES}次, 正在重启Cluster`);
        await this.restart();
        this.keepAliveErrors = []; // 重启后清空记录
        this.currentTimeoutMs = this.INITIAL_TIMEOUT_MS; // 重启后重置超时时间
      }
  
    } finally {
      // 无论成功失败都调度下一次保活
      void this.schedule();
    }
  }  

  private async keepAlive(): Promise<boolean> {
    if (!this.cluster.isEnabled) {
      throw new Error('节点未启用')
    }
    if (!this.socket) {
      throw new Error('未连接到服务器')
    }

    const counters = clone(this.cluster.counters)
    const [err, date] = (await this.socket.emitWithAck('keep-alive', {
      time: new Date(),
      ...counters,
    })) as [object, unknown]

    if (err) throw new Error('保活失败', {cause: err})
    const bytes = prettyBytes(counters.bytes, {binary: true})
    logger.info(`保活成功，距上一次保活期间提供了 ${counters.hits} 个文件，总大小 ${bytes} 字节`)
    this.cluster.counters.hits -= counters.hits
    this.cluster.counters.bytes -= counters.bytes
    return !!date
  }

  private async restart(): Promise<void> {
    await Bluebird.try(async () => {
      await this.cluster.disable()
      this.cluster.connect()
      await this.cluster.enable()
    })
      .timeout(ms('10m'), '重启超时')
      .catch((e) => {
        logger.error(e, '重启失败')
        this.cluster.exit(1)
      })
  }
}
