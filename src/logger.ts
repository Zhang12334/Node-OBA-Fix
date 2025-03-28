import {pino} from 'pino'

export const logger = pino({
  level: process.env.LOGLEVEL || 'info',
  transport: process.env.PLAIN_LOG
  ? undefined
  :{
    target: 'pino-pretty', // 使用官方提供的格式化工具
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
      messageFormat: '[Cluster] {msg}'
    }
  }
});

export const dash_logger = pino({
  level: process.env.LOGLEVEL || 'info',
  transport: process.env.PLAIN_LOG
  ? undefined
  :{
    target: 'pino-pretty', // 使用官方提供的格式化工具
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
      messageFormat: '[Dashboard] {msg}'
    }
  }
});