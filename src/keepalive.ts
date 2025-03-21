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
  private keepAliveError = 0

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
      const status = await pTimeout(this.keepAlive(), {
        milliseconds: ms('10s'),
      })
      if (!status) {
        logger.fatal('节点被主控踢下线')
        return await this.restart()
      }
      this.keepAliveError = 0
    } catch (e) {
      this.keepAliveError++
      logger.error(e, '保活失败')
      if (this.keepAliveError >= 3) {
        await this.restart()
      }
    } finally {
      void this.schedule()
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
    logger.info(`保活成功，提供了 ${counters.hits} 个文件, 大小 ${bytes}`)
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
