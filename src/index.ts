import cluster from 'cluster'
import {config} from 'dotenv'
import {readFileSync} from 'fs'
import ms from 'ms'
import {fileURLToPath} from 'url'
import {bootstrap} from './bootstrap.js'
import {logger} from './logger.js'

const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  version: string
}

// 加载环境变量
config()

// 如果以非守护进程模式运行，直接启动应用
if (process.env.NO_DAEMON || !cluster.isPrimary) {
  bootstrap(packageJson.version).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err)
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })
}

// 如果以守护进程模式运行，创建子进程
if (!process.env.NO_DAEMON && cluster.isPrimary) {
  forkWorker()
}

const BACKOFF_FACTOR = 2
let backoff = 1

function forkWorker(): void {
  const worker = cluster.fork()

  // 监听退出
  worker.on('exit', (code, signal) => {
    if (process.env.RESTART_PROCESS === 'false') {
      // 不启用自动重启
      logger.warn(`工作进程 ${worker.id} 异常退出, code: ${code}, signal: ${signal}, 正在退出进程`)      
    } else {
      // 如果启用自动重启
      const delay = process.env.ENABLE_EXIT_DELAY === 'true'
        ? parseInt(process.env.EXIT_DELAY || '3', 10) * 1000 // 使用自定义延迟时间
        : backoff * 1000 // 使用退避策略

      logger.warn(`工作进程 ${worker.id} 异常退出, code: ${code}, signal: ${signal}, ${delay / 1000}秒后重启`)
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

  // 定义进程关闭逻辑
  function onStop(signal: string): void {
    worker.removeAllListeners('exit')
    worker.kill(signal)
    worker.on('exit', () => {
      // eslint-disable-next-line n/no-process-exit
      process.exit(0)
    })
    const ref = setTimeout(() => {
      // eslint-disable-next-line n/no-process-exit
      process.exit(0)
    }, ms('30s'))
    ref.unref()
  }

  // 监听 SIGINT 和 SIGTERM 信号
  process.on('SIGINT', onStop)
  process.on('SIGTERM', onStop)
}
