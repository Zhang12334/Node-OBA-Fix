import {pino} from 'pino'

// Cluster Log
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

// Dashboard Log
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

// Sync Log
export const sync_logger = pino({
  level: process.env.LOGLEVEL || 'info',
  transport: process.env.PLAIN_LOG
  ? undefined
  :{
    target: 'pino-pretty', // 使用官方提供的格式化工具
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
      messageFormat: '[Sync] {msg}'
    }
  }
});